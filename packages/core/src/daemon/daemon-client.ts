import {connect, type Socket} from 'node:net'
import {EventEmitter} from 'node:events'
import type {PipelineEvent} from '../reporter.js'
import type {SerializedSessionState} from '../event-aggregator.js'
import type {Pipeline} from '../types.js'
import type {DaemonCommand, DaemonMessage} from './protocol.js'
import {NdjsonDecoder} from './ndjson.js'
import {DaemonError} from '../errors.js'

export type DaemonClientEvents = {
  event: [PipelineEvent];
  done: [boolean];
  error: [Error];
  close: undefined[];
}

/**
 * Client that connects to a running daemon via Unix domain socket.
 * Emits typed events for pipeline progress monitoring.
 */
export class DaemonClient extends EventEmitter<DaemonClientEvents> {
  /**
   * Connects to a daemon via its Unix domain socket.
   */
  static async connect(socketPath: string): Promise<DaemonClient> {
    const client = new DaemonClient()

    return new Promise<DaemonClient>((resolve, reject) => {
      const socket = connect(socketPath, () => {
        client.socket = socket
        client.setupDecoder()
        resolve(client)
      })

      socket.on('error', (error: Error) => {
        if (client.socket) {
          client.emit('error', error)
        } else {
          reject(new DaemonError(`Failed to connect to daemon: ${error.message}`, {cause: error}))
        }
      })

      socket.on('close', () => {
        client.emit('close')
      })
    })
  }

  private socket: Socket | undefined
  private decoder: NdjsonDecoder | undefined

  private constructor() {
    super()
  }

  /**
   * Sends a run command to the daemon.
   * @returns The job ID assigned by the daemon.
   */
  async run(pipeline: Pipeline, options?: {
    workspace?: string;
    force?: true | string[];
    target?: string[];
    concurrency?: number;
    envFile?: string;
  }): Promise<string> {
    this.send({type: 'run', pipeline, options})
    return this.waitForAck()
  }

  /**
   * Requests the current session state from the daemon.
   */
  async status(): Promise<SerializedSessionState> {
    this.send({type: 'status'})
    return this.waitForState()
  }

  /**
   * Subscribes to the event stream from the daemon.
   */
  async subscribe(options?: {logs?: boolean}): Promise<void> {
    this.send({type: 'subscribe', ...options})
  }

  /**
   * Sends a cancel command to the daemon.
   */
  async cancel(): Promise<void> {
    this.send({type: 'cancel'})
  }

  /**
   * Disconnects from the daemon.
   */
  async disconnect(): Promise<void> {
    if (this.decoder) {
      this.decoder.destroy()
      this.decoder = undefined
    }

    if (this.socket) {
      this.socket.destroy()
      this.socket = undefined
    }
  }

  private send(command: DaemonCommand): void {
    if (!this.socket) {
      throw new DaemonError('Not connected to daemon')
    }

    this.socket.write(JSON.stringify(command) + '\n')
  }

  private setupDecoder(): void {
    this.decoder = new NdjsonDecoder()
    this.socket!.pipe(this.decoder)

    this.decoder.on('data', (data: unknown) => {
      this.handleMessage(data as DaemonMessage)
    })

    this.decoder.on('error', (error: Error) => {
      this.emit('error', error)
    })
  }

  private handleMessage(message: DaemonMessage): void {
    switch (message.type) {
      case 'event': {
        this.emit('event', message.event)
        break
      }

      case 'done': {
        this.emit('done', message.success)
        break
      }

      case 'error':
      case 'state':
      case 'ack': {
        // Handled by waitForAck/waitForState via decoder data event.
        // Do NOT emit 'error' here — it would crash if no listener is attached,
        // and waitForAck/waitForState already handle these message types.
        break
      }
    }
  }

  private async waitForAck(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const onData = (data: unknown) => {
        const msg = data as DaemonMessage
        if (msg.type === 'ack') {
          cleanup()
          resolve(msg.jobId)
        } else if (msg.type === 'error') {
          cleanup()
          reject(new DaemonError(msg.message))
        }
      }

      const onClose = () => {
        cleanup()
        reject(new DaemonError('Connection closed before receiving ack'))
      }

      const cleanup = () => {
        this.decoder?.off('data', onData)
        this.socket?.off('close', onClose)
      }

      this.decoder?.on('data', onData)
      this.socket?.on('close', onClose)
    })
  }

  private async waitForState(): Promise<SerializedSessionState> {
    return new Promise<SerializedSessionState>((resolve, reject) => {
      const onData = (data: unknown) => {
        const msg = data as DaemonMessage
        if (msg.type === 'state') {
          cleanup()
          resolve(msg.session)
        } else if (msg.type === 'error') {
          cleanup()
          reject(new DaemonError(msg.message))
        }
      }

      const onClose = () => {
        cleanup()
        reject(new DaemonError('Connection closed before receiving state'))
      }

      const cleanup = () => {
        this.decoder?.off('data', onData)
        this.socket?.off('close', onClose)
      }

      this.decoder?.on('data', onData)
      this.socket?.on('close', onClose)
    })
  }
}
