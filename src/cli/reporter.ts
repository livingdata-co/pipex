import pino from 'pino'
import chalk from 'chalk'
import ora, {type Ora} from 'ora'
import type {RunContainerResult} from '../engine/types.js'
import {formatDuration, formatSize} from './utils.js'

/** Reference to a step for display and keying purposes. */
export type StepRef = {
  id: string;
  displayName: string;
}

/**
 * Discriminated union of pipeline execution events.
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
export type PipelineStartEvent = {
  event: 'PIPELINE_START';
  workspaceId: string;
  pipelineName: string;
  jobId?: string;
}

export type StepStartingEvent = {
  event: 'STEP_STARTING';
  workspaceId: string;
  step: StepRef;
  jobId?: string;
}

export type StepSkippedEvent = {
  event: 'STEP_SKIPPED';
  workspaceId: string;
  step: StepRef;
  runId: string;
  jobId?: string;
}

export type StepFinishedEvent = {
  event: 'STEP_FINISHED';
  workspaceId: string;
  step: StepRef;
  runId?: string;
  durationMs?: number;
  artifactSize?: number;
  ephemeral?: boolean;
  jobId?: string;
}

export type StepFailedEvent = {
  event: 'STEP_FAILED';
  workspaceId: string;
  step: StepRef;
  exitCode: number;
  jobId?: string;
}

export type StepRetryingEvent = {
  event: 'STEP_RETRYING';
  workspaceId: string;
  step: StepRef;
  attempt: number;
  maxRetries: number;
  jobId?: string;
}

export type StepWouldRunEvent = {
  event: 'STEP_WOULD_RUN';
  workspaceId: string;
  step: StepRef;
  jobId?: string;
}

export type PipelineFinishedEvent = {
  event: 'PIPELINE_FINISHED';
  workspaceId: string;
  totalArtifactSize: number;
  jobId?: string;
}

export type PipelineFailedEvent = {
  event: 'PIPELINE_FAILED';
  workspaceId: string;
  jobId?: string;
}

export type PipelineEvent =
  | PipelineStartEvent
  | StepStartingEvent
  | StepSkippedEvent
  | StepFinishedEvent
  | StepFailedEvent
  | StepRetryingEvent
  | StepWouldRunEvent
  | PipelineFinishedEvent
  | PipelineFailedEvent

/**
 * Interface for reporting pipeline execution events.
 */
export type Reporter = {
  /** Reports pipeline and step state transitions */
  emit(event: PipelineEvent): void;
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

  emit(event: PipelineEvent): void {
    this.logger.info(event)
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

  emit(event: PipelineEvent): void {
    switch (event.event) {
      case 'PIPELINE_START': {
        const displayName = event.pipelineName
        console.log(chalk.bold(`\n▶ Pipeline: ${chalk.cyan(displayName)}\n`))
        break
      }

      case 'STEP_STARTING': {
        const spinner = ora({text: event.step.displayName, prefixText: '  '}).start()
        this.stepSpinners.set(event.step.id, spinner)
        break
      }

      case 'STEP_SKIPPED': {
        const spinner = this.stepSpinners.get(event.step.id)
        if (spinner) {
          spinner.stopAndPersist({symbol: chalk.gray('⊙'), text: chalk.gray(`${event.step.displayName} (cached)`)})
          this.stepSpinners.delete(event.step.id)
        } else {
          console.log(`  ${chalk.gray('⊙')} ${chalk.gray(`${event.step.displayName} (cached)`)}`)
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
        const spinner = this.stepSpinners.get(event.step.id)
        if (spinner) {
          spinner.text = `${event.step.displayName} (retry ${event.attempt}/${event.maxRetries})`
        }

        break
      }

      case 'STEP_WOULD_RUN': {
        this.handleStepWouldRun(event.step)
        break
      }

      case 'PIPELINE_FINISHED': {
        this.handlePipelineFinished(event)
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

  private handleStepFinished(event: StepFinishedEvent): void {
    const spinner = this.stepSpinners.get(event.step.id)
    if (spinner) {
      const details: string[] = []
      if (typeof event.durationMs === 'number') {
        details.push(formatDuration(event.durationMs))
      }

      if (typeof event.artifactSize === 'number' && event.artifactSize > 0) {
        details.push(formatSize(event.artifactSize))
      }

      const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
      spinner.stopAndPersist({symbol: chalk.green('✓'), text: chalk.green(`${event.step.displayName}${suffix}`)})
      this.stepSpinners.delete(event.step.id)
    }

    this.stderrBuffers.delete(event.step.id)
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

  private handlePipelineFinished(event: PipelineFinishedEvent): void {
    const parts = ['Pipeline completed']
    if (event.totalArtifactSize > 0) {
      parts.push(`(${formatSize(event.totalArtifactSize)})`)
    }

    console.log(chalk.bold.green(`\n✓ ${parts.join(' ')}\n`))
  }

  private handleStepFailed(event: StepFailedEvent): void {
    const spinner = this.stepSpinners.get(event.step.id)
    if (spinner) {
      const exitInfo = ` (exit ${event.exitCode})`
      spinner.stopAndPersist({
        symbol: chalk.red('✗'),
        text: chalk.red(`${event.step.displayName}${exitInfo}`)
      })
      this.stepSpinners.delete(event.step.id)
    }

    const stderr = this.stderrBuffers.get(event.step.id)
    if (stderr && stderr.length > 0) {
      console.log(chalk.red('  ── stderr ──'))
      for (const line of stderr) {
        console.log(chalk.red(`  ${line}`))
      }
    }

    this.stderrBuffers.delete(event.step.id)
  }
}
