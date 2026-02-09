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

/**
 * Interface for reporting pipeline execution events.
 */
export type Reporter = {
  /** Reports pipeline and step state transitions */
  state(workspaceId: string, event: PipelineEvent, stepId?: string, meta?: Record<string, unknown>): void;
  /** Reports container logs (stdout/stderr) */
  log(workspaceId: string, stepId: string, stream: 'stdout' | 'stderr', line: string): void;
  /** Reports container execution result */
  result(workspaceId: string, stepId: string, result: RunContainerResult): void;
}

/**
 * Reporter that outputs structured JSON logs via pino.
 * Suitable for CI/CD environments and log aggregation.
 */
export class ConsoleReporter implements Reporter {
  private readonly logger = pino({level: 'info'})

  state(workspaceId: string, event: PipelineEvent, stepId?: string, meta?: Record<string, unknown>): void {
    this.logger.info({workspaceId, event, stepId, ...meta})
  }

  log(workspaceId: string, stepId: string, stream: 'stdout' | 'stderr', line: string): void {
    this.logger.info({workspaceId, stepId, stream, line})
  }

  result(workspaceId: string, stepId: string, result: RunContainerResult): void {
    this.logger.info({workspaceId, stepId, result})
  }
}

/**
 * Reporter with interactive terminal UI using spinners and colors.
 * Suitable for local development and manual execution.
 */
export class InteractiveReporter implements Reporter {
  private readonly spinner?: Ora
  private readonly stepSpinners = new Map<string, Ora>()

  state(workspaceId: string, event: PipelineEvent, stepId?: string, meta?: Record<string, unknown>): void {
    if (event === 'PIPELINE_START') {
      console.log(chalk.bold(`\n▶ Pipeline: ${chalk.cyan(workspaceId)}\n`))
    }

    if (event === 'STEP_STARTING' && stepId) {
      const spinner = ora({text: stepId, prefixText: '  '}).start()
      this.stepSpinners.set(stepId, spinner)
    }

    if (event === 'STEP_SKIPPED' && stepId) {
      const spinner = this.stepSpinners.get(stepId)
      if (spinner) {
        spinner.stopAndPersist({symbol: chalk.gray('⊙'), text: chalk.gray(`${stepId} (cached)`)})
        this.stepSpinners.delete(stepId)
      } else {
        // Step was skipped before spinner was created
        console.log(`  ${chalk.gray('⊙')} ${chalk.gray(`${stepId} (cached)`)}`)
      }
    }

    if (event === 'STEP_FINISHED' && stepId) {
      const spinner = this.stepSpinners.get(stepId)
      if (spinner) {
        spinner.stopAndPersist({symbol: chalk.green('✓'), text: chalk.green(stepId)})
        this.stepSpinners.delete(stepId)
      }
    }

    if (event === 'STEP_FAILED' && stepId) {
      const spinner = this.stepSpinners.get(stepId)
      const exitCode = meta?.exitCode as number | undefined
      if (spinner) {
        const exitInfo = exitCode === undefined ? '' : ` (exit ${exitCode})`
        spinner.stopAndPersist({
          symbol: chalk.red('✗'),
          text: chalk.red(`${stepId}${exitInfo}`)
        })
        this.stepSpinners.delete(stepId)
      }
    }

    if (event === 'PIPELINE_FINISHED') {
      console.log(chalk.bold.green('\n✓ Pipeline completed\n'))
    }

    if (event === 'PIPELINE_FAILED') {
      console.log(chalk.bold.red('\n✗ Pipeline failed\n'))
    }
  }

  log(_workspaceId: string, _stepId: string, _stream: 'stdout' | 'stderr', _line: string): void {
    // Suppress logs in interactive mode
  }

  result(_workspaceId: string, _stepId: string, _result: RunContainerResult): void {
    // Results shown via state updates
  }
}
