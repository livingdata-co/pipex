import pino from 'pino'
import chalk from 'chalk'
import ora, {type Ora} from 'ora'
import type {RunContainerResult} from '../engine/types.js'
import {formatDuration, formatSize} from './utils.js'

/**
 * Events emitted during pipeline execution.
 *
 * Lifecycle:
 * 1. PIPELINE_START - Pipeline execution begins
 * 2. For each step:
 *    a. STEP_STARTING - Step begins execution
 *    b. STEP_FINISHED - Step succeeded
 *       OR STEP_FAILED - Step failed (pipeline stops unless allowFailure)
 *       OR STEP_SKIPPED - Step skipped due to cache hit
 *       OR STEP_WOULD_RUN - Step would run (dry-run mode)
 * 3. PIPELINE_FINISHED - All steps completed successfully
 *    OR PIPELINE_FAILED - Pipeline stopped due to step failure
 */
export type PipelineEvent =
  | 'PIPELINE_START'
  | 'STEP_STARTING'
  | 'STEP_SKIPPED'
  | 'STEP_FINISHED'
  | 'STEP_FAILED'
  | 'STEP_WOULD_RUN'
  | 'PIPELINE_FINISHED'
  | 'PIPELINE_FAILED'

/** Reference to a step for display and keying purposes. */
export type StepRef = {
  id: string;
  displayName: string;
}

/**
 * Interface for reporting pipeline execution events.
 */
export type Reporter = {
  /** Reports pipeline and step state transitions */
  state(workspaceId: string, event: PipelineEvent, step?: StepRef, meta?: Record<string, unknown>): void;
  /** Reports container logs (stdout/stderr) */
  log(workspaceId: string, step: StepRef, stream: 'stdout' | 'stderr', line: string): void;
  /** Reports container execution result */
  result(workspaceId: string, step: StepRef, result: RunContainerResult): void;
}

/**
 * Reporter that outputs structured JSON logs via pino.
 * Suitable for CI/CD environments and log aggregation.
 */
export class ConsoleReporter implements Reporter {
  private readonly logger = pino({level: 'info'})

  state(workspaceId: string, event: PipelineEvent, step?: StepRef, meta?: Record<string, unknown>): void {
    const stepName = step?.displayName === step?.id ? undefined : step?.displayName
    this.logger.info({workspaceId, event, stepId: step?.id, stepName, ...meta})
  }

  log(workspaceId: string, step: StepRef, stream: 'stdout' | 'stderr', line: string): void {
    this.logger.info({workspaceId, stepId: step.id, stream, line})
  }

  result(workspaceId: string, step: StepRef, result: RunContainerResult): void {
    this.logger.info({workspaceId, stepId: step.id, result})
  }
}

/**
 * Reporter with interactive terminal UI using spinners and colors.
 * Suitable for local development and manual execution.
 */
export class InteractiveReporter implements Reporter {
  private static get maxStderrLines() {
    return 20
  }

  private readonly verbose: boolean
  private readonly spinner?: Ora
  private readonly stepSpinners = new Map<string, Ora>()
  private readonly stderrBuffers = new Map<string, string[]>()

  constructor(options?: {verbose?: boolean}) {
    this.verbose = options?.verbose ?? false
  }

  state(workspaceId: string, event: PipelineEvent, step?: StepRef, meta?: Record<string, unknown>): void {
    switch (event) {
      case 'PIPELINE_START': {
        const displayName = (meta?.pipelineName as string | undefined) ?? workspaceId
        console.log(chalk.bold(`\n▶ Pipeline: ${chalk.cyan(displayName)}\n`))
        break
      }

      case 'STEP_STARTING': {
        if (step) {
          const spinner = ora({text: step.displayName, prefixText: '  '}).start()
          this.stepSpinners.set(step.id, spinner)
        }

        break
      }

      case 'STEP_SKIPPED': {
        if (step) {
          const spinner = this.stepSpinners.get(step.id)
          if (spinner) {
            spinner.stopAndPersist({symbol: chalk.gray('⊙'), text: chalk.gray(`${step.displayName} (cached)`)})
            this.stepSpinners.delete(step.id)
          } else {
            console.log(`  ${chalk.gray('⊙')} ${chalk.gray(`${step.displayName} (cached)`)}`)
          }
        }

        break
      }

      case 'STEP_FINISHED': {
        if (step) {
          this.handleStepFinished(step, meta)
        }

        break
      }

      case 'STEP_FAILED': {
        if (step) {
          this.handleStepFailed(step, meta)
        }

        break
      }

      case 'STEP_WOULD_RUN': {
        if (step) {
          this.handleStepWouldRun(step)
        }

        break
      }

      case 'PIPELINE_FINISHED': {
        this.handlePipelineFinished(meta)
        break
      }

      case 'PIPELINE_FAILED': {
        console.log(chalk.bold.red('\n✗ Pipeline failed\n'))
        break
      }
    }
  }

  log(_workspaceId: string, step: StepRef, stream: 'stdout' | 'stderr', line: string): void {
    if (this.verbose) {
      const spinner = this.stepSpinners.get(step.id)
      const prefix = chalk.gray(`  [${step.id}]`)
      if (spinner) {
        spinner.clear()
        console.log(`${prefix} ${line}`)
        spinner.render()
      } else {
        console.log(`${prefix} ${line}`)
      }
    }

    if (stream === 'stderr') {
      let buffer = this.stderrBuffers.get(step.id)
      if (!buffer) {
        buffer = []
        this.stderrBuffers.set(step.id, buffer)
      }

      buffer.push(line)
      if (buffer.length > InteractiveReporter.maxStderrLines) {
        buffer.shift()
      }
    }
  }

  result(_workspaceId: string, _step: StepRef, _result: RunContainerResult): void {
    // Results shown via state updates
  }

  private handleStepFinished(step: StepRef, meta?: Record<string, unknown>): void {
    const spinner = this.stepSpinners.get(step.id)
    if (spinner) {
      const details: string[] = []
      if (typeof meta?.durationMs === 'number') {
        details.push(formatDuration(meta.durationMs))
      }

      if (typeof meta?.artifactSize === 'number' && meta.artifactSize > 0) {
        details.push(formatSize(meta.artifactSize))
      }

      const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
      spinner.stopAndPersist({symbol: chalk.green('✓'), text: chalk.green(`${step.displayName}${suffix}`)})
      this.stepSpinners.delete(step.id)
    }

    this.stderrBuffers.delete(step.id)
  }

  private handleStepWouldRun(step: StepRef): void {
    const spinner = this.stepSpinners.get(step.id)
    if (spinner) {
      spinner.stopAndPersist({symbol: chalk.yellow('○'), text: chalk.yellow(`${step.displayName} (would run)`)})
      this.stepSpinners.delete(step.id)
    } else {
      console.log(`  ${chalk.yellow('○')} ${chalk.yellow(`${step.displayName} (would run)`)}`)
    }
  }

  private handlePipelineFinished(meta?: Record<string, unknown>): void {
    const parts = ['Pipeline completed']
    if (typeof meta?.totalArtifactSize === 'number' && meta.totalArtifactSize > 0) {
      parts.push(`(${formatSize(meta.totalArtifactSize)})`)
    }

    console.log(chalk.bold.green(`\n✓ ${parts.join(' ')}\n`))
  }

  private handleStepFailed(step: StepRef, meta?: Record<string, unknown>): void {
    const spinner = this.stepSpinners.get(step.id)
    const exitCode = meta?.exitCode as number | undefined
    if (spinner) {
      const exitInfo = exitCode === undefined ? '' : ` (exit ${exitCode})`
      spinner.stopAndPersist({
        symbol: chalk.red('✗'),
        text: chalk.red(`${step.displayName}${exitInfo}`)
      })
      this.stepSpinners.delete(step.id)
    }

    const stderr = this.stderrBuffers.get(step.id)
    if (stderr && stderr.length > 0) {
      console.log(chalk.red('  ── stderr ──'))
      for (const line of stderr) {
        console.log(chalk.red(`  ${line}`))
      }
    }

    this.stderrBuffers.delete(step.id)
  }
}
