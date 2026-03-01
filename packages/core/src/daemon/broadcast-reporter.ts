import type {Writable} from 'node:stream'
import type {Reporter, PipelineEvent} from '../reporter.js'
import {NdjsonEncoder} from './ndjson.js'
import type {DaemonMessage} from './protocol.js'

/**
 * Reporter that pushes events to all connected socket clients.
 * Each client gets its own NdjsonEncoder stream.
 */
export class BroadcastReporter implements Reporter {
  private readonly clients = new Map<Writable, NdjsonEncoder>()

  addClient(stream: Writable): void {
    const encoder = new NdjsonEncoder()
    encoder.pipe(stream)
    this.clients.set(stream, encoder)

    stream.on('error', () => {
      this.removeClient(stream)
    })

    stream.on('close', () => {
      this.removeClient(stream)
    })
  }

  removeClient(stream: Writable): void {
    const encoder = this.clients.get(stream)
    if (encoder) {
      encoder.unpipe(stream)
      encoder.destroy()
      this.clients.delete(stream)
    }
  }

  get clientCount(): number {
    return this.clients.size
  }

  emit(event: PipelineEvent): void {
    const message: DaemonMessage = {type: 'event', event}

    // eslint-disable-next-line unicorn/no-useless-spread -- snapshot to avoid mutation during iteration
    for (const [stream, encoder] of [...this.clients]) {
      try {
        encoder.write(message)
      } catch {
        this.removeClient(stream)
      }
    }
  }

  /**
   * Sends a raw DaemonMessage to all connected clients.
   */
  broadcast(message: DaemonMessage): void {
    // eslint-disable-next-line unicorn/no-useless-spread -- snapshot to avoid mutation during iteration
    for (const [stream, encoder] of [...this.clients]) {
      try {
        encoder.write(message)
      } catch {
        this.removeClient(stream)
      }
    }
  }

  /**
   * Sends a raw DaemonMessage to a specific client stream.
   */
  sendTo(stream: Writable, message: DaemonMessage): void {
    const encoder = this.clients.get(stream)
    if (encoder) {
      try {
        encoder.write(message)
      } catch {
        this.removeClient(stream)
      }
    }
  }
}
