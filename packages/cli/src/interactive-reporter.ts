import process from 'node:process'
import {createLogUpdate} from 'log-update'
import chalk from 'chalk'
import {type Reporter, type PipelineEvent, type StepFinishedEvent, type StepFailedEvent, formatDuration, formatSize} from '@tylt/core'

type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'would-run'

type StepDisplayState = {
  displayName: string;
  status: StepStatus;
  detail?: string;
}

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Reporter with interactive terminal UI using log-update for multi-step display.
 * Suitable for local development and manual execution.
 */
export class InteractiveReporter implements Reporter {
  private static get maxStderrLines() {
    return 20
  }

  private readonly verbose: boolean
  private readonly logUpdate = createLogUpdate(process.stderr)
  private readonly steps = new Map<string, StepDisplayState>()
  private readonly stderrBuffers = new Map<string, string[]>()
  private frame = 0
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(options?: {verbose?: boolean}) {
    this.verbose = options?.verbose ?? false
  }

  emit(event: PipelineEvent): void {
    switch (event.event) {
      case 'PIPELINE_START': {
        console.error(chalk.bold(`\n▶ Pipeline: ${chalk.cyan(event.pipelineName)}\n`))
        for (const step of event.steps) {
          this.steps.set(step.id, {displayName: step.displayName, status: 'pending'})
        }

        this.startRendering()
        break
      }

      case 'STEP_STARTING': {
        const step = this.steps.get(event.step.id)
        if (step) {
          step.status = 'running'
        } else {
          this.steps.set(event.step.id, {displayName: event.step.displayName, status: 'running'})
          this.startRendering()
        }

        break
      }

      case 'STEP_SKIPPED': {
        const reasonLabel = event.reason === 'cached'
          ? '(cached)'
          : (event.reason === 'condition'
            ? '(condition)'
            : '(dependency skipped)')
        const step = this.steps.get(event.step.id)
        if (step) {
          step.status = 'skipped'
          step.detail = ` ${reasonLabel}`
        } else {
          this.steps.set(event.step.id, {displayName: event.step.displayName, status: 'skipped', detail: ` ${reasonLabel}`})
        }

        break
      }

      case 'STEP_FINISHED': {
        this.handleStepFinished(event)
        break
      }

      case 'STEP_FAILED': {
        this.handleStepFailed(event)
        break
      }

      case 'STEP_RETRYING': {
        const step = this.steps.get(event.step.id)
        if (step) {
          step.displayName = `${event.step.displayName} (retry ${event.attempt}/${event.maxRetries})`
        }

        break
      }

      case 'STEP_WOULD_RUN': {
        const step = this.steps.get(event.step.id)
        if (step) {
          step.status = 'would-run'
        }

        break
      }

      case 'PIPELINE_FINISHED': {
        this.stopRendering()
        const parts = ['Pipeline completed']
        if (event.totalArtifactSize > 0) {
          parts.push(`(${formatSize(event.totalArtifactSize)})`)
        }

        console.error(chalk.bold.green(`\n✓ ${parts.join(' ')}\n`))
        break
      }

      case 'PIPELINE_FAILED': {
        this.stopRendering()
        this.printFailedStderr()
        console.error(chalk.bold.red('\n✗ Pipeline failed\n'))
        break
      }

      case 'STEP_LOG': {
        if (this.verbose) {
          const prefix = chalk.gray(`  [${event.step.id}]`)
          this.logUpdate.clear()
          console.error(`${prefix} ${event.line}`)
          this.render()
        }

        if (event.stream === 'stderr') {
          let buffer = this.stderrBuffers.get(event.step.id)
          if (!buffer) {
            buffer = []
            this.stderrBuffers.set(event.step.id, buffer)
          }

          buffer.push(event.line)
          if (buffer.length > InteractiveReporter.maxStderrLines) {
            buffer.shift()
          }
        }

        break
      }
    }
  }

  private render(): void {
    const lines: string[] = []
    for (const step of this.steps.values()) {
      const symbol = this.symbolFor(step)
      const text = this.textFor(step)
      lines.push(`  ${symbol} ${text}`)
    }

    this.logUpdate(lines.join('\n'))
    this.frame++
  }

  private symbolFor(step: StepDisplayState): string {
    switch (step.status) {
      case 'pending': {
        return chalk.gray('○')
      }

      case 'running': {
        return chalk.cyan(spinnerFrames[this.frame % spinnerFrames.length])
      }

      case 'done': {
        return chalk.green('✓')
      }

      case 'skipped': {
        return chalk.gray('⊙')
      }

      case 'failed': {
        return chalk.red('✗')
      }

      case 'would-run': {
        return chalk.yellow('○')
      }
    }
  }

  private textFor(step: StepDisplayState): string {
    const suffix = step.detail ?? ''
    switch (step.status) {
      case 'pending': {
        return chalk.gray(step.displayName)
      }

      case 'running': {
        return step.displayName
      }

      case 'done': {
        return chalk.green(`${step.displayName}${suffix}`)
      }

      case 'skipped': {
        return chalk.gray(`${step.displayName}${suffix}`)
      }

      case 'failed': {
        return chalk.red(`${step.displayName}${suffix}`)
      }

      case 'would-run': {
        return chalk.yellow(`${step.displayName} (would run)`)
      }
    }
  }

  private startRendering(): void {
    if (!this.timer) {
      this.render()
      this.timer = setInterval(() => {
        this.render()
      }, 80)
    }
  }

  private stopRendering(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }

    this.render()
    this.logUpdate.done()
  }

  private handleStepFinished(event: StepFinishedEvent): void {
    const step = this.steps.get(event.step.id)
    if (step) {
      step.status = 'done'
      const details: string[] = []
      if (typeof event.durationMs === 'number') {
        details.push(formatDuration(event.durationMs))
      }

      if (typeof event.artifactSize === 'number' && event.artifactSize > 0) {
        details.push(formatSize(event.artifactSize))
      }

      if (details.length > 0) {
        step.detail = ` (${details.join(', ')})`
      }
    }

    this.stderrBuffers.delete(event.step.id)
  }

  private handleStepFailed(event: StepFailedEvent): void {
    const step = this.steps.get(event.step.id)
    if (step) {
      step.status = 'failed'
      step.detail = ` (exit ${event.exitCode})`
    }
  }

  private printFailedStderr(): void {
    for (const [stepId, step] of this.steps) {
      if (step.status === 'failed') {
        const stderr = this.stderrBuffers.get(stepId)
        if (stderr?.length) {
          console.error(chalk.red(`  ── ${step.displayName} stderr ──`))
          for (const line of stderr) {
            console.error(chalk.red(`  ${line}`))
          }
        }
      }
    }
  }
}
