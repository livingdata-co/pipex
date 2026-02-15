import type {PipelineEvent, Reporter} from './reporter.js'
import type {EventTransport, TransportMessage} from './transport.js'

/**
 * Reporter that wraps events into TransportMessages and publishes them.
 * Ignores STEP_LOG events (high volume, not suitable for transport).
 */
export class StreamReporter implements Reporter {
  private seq = 0

  constructor(private readonly transport: EventTransport) {}

  emit(event: PipelineEvent): void {
    if (event.event === 'STEP_LOG') {
      return
    }

    const message: TransportMessage = {
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      version: 1,
      type: event.event,
      event
    }

    void this.transport.publish(message)
  }

  async flush(): Promise<void> {
    await this.transport.flush?.()
  }
}

/**
 * Delegates emit() to multiple reporters.
 */
export class CompositeReporter implements Reporter {
  private readonly reporters: Reporter[]

  constructor(...reporters: Reporter[]) {
    this.reporters = reporters
  }

  emit(event: PipelineEvent): void {
    for (const reporter of this.reporters) {
      reporter.emit(event)
    }
  }
}
