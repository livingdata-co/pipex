import pino from 'pino'

/** Reference to a step for display and keying purposes. */
export type StepRef = {
  id: string;
  displayName: string;
}

/** Common fields identifying an execution session. */
export type JobContext = {
  workspaceId: string;
  jobId: string;
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
 *    c. STEP_LOG - Container log line (stdout/stderr)
 * 3. PIPELINE_FINISHED - All steps completed successfully
 *    OR PIPELINE_FAILED - Pipeline stopped due to step failure
 */
export type PipelineStartEvent = {
  event: 'PIPELINE_START';
  workspaceId: string;
  pipelineName: string;
  steps: StepRef[];
  jobId: string;
  groupId?: string;
}

export type StepStartingEvent = {
  event: 'STEP_STARTING';
  workspaceId: string;
  step: StepRef;
  jobId: string;
  groupId?: string;
}

export type StepSkippedEvent = {
  event: 'STEP_SKIPPED';
  workspaceId: string;
  step: StepRef;
  runId?: string;
  reason: 'cached' | 'condition' | 'dependency';
  jobId: string;
  groupId?: string;
}

export type StepFinishedEvent = {
  event: 'STEP_FINISHED';
  workspaceId: string;
  step: StepRef;
  runId?: string;
  durationMs?: number;
  artifactSize?: number;
  ephemeral?: boolean;
  jobId: string;
  groupId?: string;
}

export type StepFailedEvent = {
  event: 'STEP_FAILED';
  workspaceId: string;
  step: StepRef;
  exitCode: number;
  jobId: string;
  groupId?: string;
}

export type StepRetryingEvent = {
  event: 'STEP_RETRYING';
  workspaceId: string;
  step: StepRef;
  attempt: number;
  maxRetries: number;
  jobId: string;
  groupId?: string;
}

export type StepWouldRunEvent = {
  event: 'STEP_WOULD_RUN';
  workspaceId: string;
  step: StepRef;
  jobId: string;
  groupId?: string;
}

export type PipelineFinishedEvent = {
  event: 'PIPELINE_FINISHED';
  workspaceId: string;
  totalArtifactSize: number;
  jobId: string;
  groupId?: string;
}

export type PipelineFailedEvent = {
  event: 'PIPELINE_FAILED';
  workspaceId: string;
  jobId: string;
  groupId?: string;
}

export type StepLogEvent = {
  event: 'STEP_LOG';
  workspaceId: string;
  jobId: string;
  groupId?: string;
  step: StepRef;
  stream: 'stdout' | 'stderr';
  line: string;
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
  | StepLogEvent

/**
 * Interface for reporting pipeline execution events.
 */
export type Reporter = {
  /** Reports pipeline and step state transitions */
  emit(event: PipelineEvent): void;
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
}

