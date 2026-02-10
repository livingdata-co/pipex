import pino from 'pino'
import chalk from 'chalk'
import ora, {type Ora} from 'ora'
import type {RunContainerResult} from '../engine/types.js'

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
 * 3. PIPELINE_FINISHED - All steps completed successfully
 *    OR PIPELINE_FAILED - Pipeline stopped due to step failure
 */
export type PipelineEvent =
  | 'PIPELINE_START'
  | 'STEP_STARTING'
  | 'STEP_SKIPPED'
  | 'STEP_FINISHED'
  | 'STEP_FAILED'
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
  private readonly spinner?: Ora
  private readonly stepSpinners = new Map<string, Ora>()

  state(workspaceId: string, event: PipelineEvent, step?: StepRef, meta?: Record<string, unknown>): void {
    if (event === 'PIPELINE_START') {
      const displayName = (meta?.pipelineName as string | undefined) ?? workspaceId
      console.log(chalk.bold(`\n▶ Pipeline: ${chalk.cyan(displayName)}\n`))
    }

    if (event === 'STEP_STARTING' && step) {
      const spinner = ora({text: step.displayName, prefixText: '  '}).start()
      this.stepSpinners.set(step.id, spinner)
    }

    if (event === 'STEP_SKIPPED' && step) {
      const spinner = this.stepSpinners.get(step.id)
      if (spinner) {
        spinner.stopAndPersist({symbol: chalk.gray('⊙'), text: chalk.gray(`${step.displayName} (cached)`)})
        this.stepSpinners.delete(step.id)
      } else {
        console.log(`  ${chalk.gray('⊙')} ${chalk.gray(`${step.displayName} (cached)`)}`)
      }
    }

    if (event === 'STEP_FINISHED' && step) {
      const spinner = this.stepSpinners.get(step.id)
      if (spinner) {
        spinner.stopAndPersist({symbol: chalk.green('✓'), text: chalk.green(step.displayName)})
        this.stepSpinners.delete(step.id)
      }
    }

    if (event === 'STEP_FAILED' && step) {
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
    }

    if (event === 'PIPELINE_FINISHED') {
      console.log(chalk.bold.green('\n✓ Pipeline completed\n'))
    }

    if (event === 'PIPELINE_FAILED') {
      console.log(chalk.bold.red('\n✗ Pipeline failed\n'))
    }
  }

  log(_workspaceId: string, _step: StepRef, _stream: 'stdout' | 'stderr', _line: string): void {
    // Suppress logs in interactive mode
  }

  result(_workspaceId: string, _step: StepRef, _result: RunContainerResult): void {
    // Results shown via state updates
  }
}
