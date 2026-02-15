import type {TransportMessage} from './transport.js'

export type StepState = {
  id: string;
  displayName: string;
  status: 'pending' | 'running' | 'skipped' | 'finished' | 'failed';
  runId?: string;
  exitCode?: number;
  durationMs?: number;
  artifactSize?: number;
}

export type SessionState = {
  workspaceId: string;
  jobId: string;
  pipelineName?: string;
  status: 'running' | 'completed' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  steps: Map<string, StepState>;
}

/**
 * Reconstructs pipeline session state from a stream of TransportMessages.
 */
export class EventAggregator {
  private readonly sessions = new Map<string, SessionState>()

  consume(message: TransportMessage): void {
    const {event} = message

    if (event.event === 'STEP_LOG') {
      return
    }

    const {jobId} = event

    switch (event.event) {
      case 'PIPELINE_START': {
        const session: SessionState = {
          workspaceId: event.workspaceId,
          jobId,
          pipelineName: event.pipelineName,
          status: 'running',
          startedAt: message.timestamp,
          steps: new Map()
        }

        for (const step of event.steps) {
          session.steps.set(step.id, {
            id: step.id,
            displayName: step.displayName,
            status: 'pending'
          })
        }

        this.sessions.set(jobId, session)
        break
      }

      case 'STEP_STARTING': {
        const step = this.getOrCreateStep(jobId, event.step.id, event.step.displayName)
        step.status = 'running'
        break
      }

      case 'STEP_SKIPPED': {
        const step = this.getOrCreateStep(jobId, event.step.id, event.step.displayName)
        step.status = 'skipped'
        if (event.runId) {
          step.runId = event.runId
        }

        break
      }

      case 'STEP_FINISHED': {
        const step = this.getOrCreateStep(jobId, event.step.id, event.step.displayName)
        step.status = 'finished'
        if (event.runId) {
          step.runId = event.runId
        }

        if (event.durationMs !== undefined) {
          step.durationMs = event.durationMs
        }

        if (event.artifactSize !== undefined) {
          step.artifactSize = event.artifactSize
        }

        break
      }

      case 'STEP_FAILED': {
        const step = this.getOrCreateStep(jobId, event.step.id, event.step.displayName)
        step.status = 'failed'
        step.exitCode = event.exitCode
        break
      }

      case 'PIPELINE_FINISHED': {
        const session = this.sessions.get(jobId)
        if (session) {
          session.status = 'completed'
          session.finishedAt = message.timestamp
        }

        break
      }

      case 'PIPELINE_FAILED': {
        const session = this.sessions.get(jobId)
        if (session) {
          session.status = 'failed'
          session.finishedAt = message.timestamp
        }

        break
      }

      case 'STEP_RETRYING':
      case 'STEP_WOULD_RUN': {
        break
      }
    }
  }

  getSession(jobId: string): SessionState | undefined {
    return this.sessions.get(jobId)
  }

  getAllSessions(): SessionState[] {
    return [...this.sessions.values()]
  }

  clear(): void {
    this.sessions.clear()
  }

  private getOrCreateStep(jobId: string, stepId: string, displayName: string): StepState {
    let session = this.sessions.get(jobId)
    if (!session) {
      session = {
        workspaceId: '',
        jobId,
        status: 'running',
        steps: new Map()
      }

      this.sessions.set(jobId, session)
    }

    let step = session.steps.get(stepId)
    if (!step) {
      step = {id: stepId, displayName, status: 'pending'}
      session.steps.set(stepId, step)
    }

    return step
  }
}
