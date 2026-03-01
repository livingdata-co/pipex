import {createServer, type Server, type Socket} from 'node:net'
import {join} from 'node:path'
import {rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {Pipex, type PipexOptions} from '../pipex.js'
import {ConsoleReporter} from '../reporter.js'
import {CompositeReporter, StreamReporter} from '../stream-reporter.js'
import {InMemoryTransport} from '../transport.js'
import {EventAggregator, type SerializedSessionState, type SessionState} from '../event-aggregator.js'
import type {PipexConfig, Pipeline} from '../types.js'
import type {DaemonCommand, DaemonMessage, RunCommand} from './protocol.js'
import {WorkspaceLock} from './workspace-lock.js'
import {BroadcastReporter} from './broadcast-reporter.js'
import {NdjsonDecoder} from './ndjson.js'

const autoShutdownDelay = 5000

/**
 * Daemon server that listens on a Unix domain socket,
 * dispatches commands, and broadcasts events to connected clients.
 */
export class DaemonServer {
  readonly socketPath: string
  private server: Server | undefined
  private lock: WorkspaceLock | undefined
  private readonly broadcast = new BroadcastReporter()
  private readonly transport = new InMemoryTransport()
  private readonly aggregator = new EventAggregator()
  private readonly streamReporter: StreamReporter
  private readonly sockets = new Set<Socket>()
  private currentJobId: string | undefined
  private running = false
  private shutdownTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: {
    workspaceRoot: string;
    pipexOptions: PipexOptions;
    config?: PipexConfig;
    cwd?: string;
  }) {
    this.socketPath = join(options.workspaceRoot, 'pipex.sock')
    this.streamReporter = new StreamReporter(this.transport)

    // Wire aggregator to transport
    const originalPublish = this.transport.publish.bind(this.transport)
    this.transport.publish = async message => {
      await originalPublish(message)
      this.aggregator.consume(message)
    }
  }

  async start(): Promise<void> {
    // Clean up stale socket file
    await rm(this.socketPath, {force: true})

    this.lock = await WorkspaceLock.acquire(this.options.workspaceRoot, this.socketPath)

    return new Promise<void>((resolve, reject) => {
      this.server = createServer(socket => {
        this.handleConnection(socket)
      })

      this.server.on('error', reject)
      this.server.listen(this.socketPath, () => {
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = undefined
    }

    // Destroy all connected sockets
    for (const socket of this.sockets) {
      socket.destroy()
    }

    this.sockets.clear()

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close(error => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
      this.server = undefined
    }

    await rm(this.socketPath, {force: true})

    if (this.lock) {
      await this.lock.release()
      this.lock = undefined
    }
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket)
    const decoder = new NdjsonDecoder()
    socket.pipe(decoder)

    decoder.on('data', async (data: unknown) => {
      const command = data as DaemonCommand
      try {
        await this.handleCommand(command, socket)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        this.sendMessage(socket, {type: 'error', code: 'INTERNAL', message})
      }
    })

    socket.on('error', () => {
      this.sockets.delete(socket)
      this.broadcast.removeClient(socket)
    })

    socket.on('close', () => {
      this.sockets.delete(socket)
      this.broadcast.removeClient(socket)
      this.maybeScheduleShutdown()
    })
  }

  private async handleCommand(command: DaemonCommand, socket: Socket): Promise<void> {
    switch (command.type) {
      case 'run': {
        await this.handleRun(command.pipeline, command.options, socket)
        break
      }

      case 'status': {
        this.handleStatus(socket)
        break
      }

      case 'subscribe': {
        this.handleSubscribe(socket)
        break
      }

      case 'cancel': {
        this.handleCancel(socket)
        break
      }
    }
  }

  private async handleRun(
    pipeline: Pipeline,
    options: RunCommand['options'],
    socket: Socket
  ): Promise<void> {
    if (this.running) {
      this.sendMessage(socket, {
        type: 'error',
        code: 'ALREADY_RUNNING',
        message: 'A pipeline is already running in this workspace'
      })
      return
    }

    this.running = true

    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = undefined
    }

    const jobId = randomUUID()
    this.currentJobId = jobId

    // Add socket as subscriber so it receives events
    this.broadcast.addClient(socket)

    this.sendMessage(socket, {type: 'ack', jobId})

    const reporter = new CompositeReporter(
      new ConsoleReporter(),
      this.broadcast,
      this.streamReporter
    )

    const pipex = new Pipex({
      ...this.options.pipexOptions,
      reporter,
      config: this.options.config,
      cwd: this.options.cwd
    })

    try {
      await pipex.run(pipeline, {
        workspace: options?.workspace,
        force: options?.force,
        target: options?.target,
        concurrency: options?.concurrency,
        envFile: options?.envFile,
        skipLock: true // DaemonServer already holds the workspace lock
      })
      this.broadcast.broadcast({type: 'done', success: true})
    } catch {
      this.broadcast.broadcast({type: 'done', success: false})
    } finally {
      this.running = false
      this.currentJobId = undefined
      this.maybeScheduleShutdown()
    }
  }

  private handleStatus(socket: Socket): void {
    if (this.currentJobId) {
      const session = this.aggregator.getSession(this.currentJobId)
      if (session) {
        this.sendMessage(socket, {type: 'state', session: this.serializeSession(session)})
        return
      }
    }

    // No active session — check for most recent
    const sessions = this.aggregator.getAllSessions()
    if (sessions.length > 0) {
      this.sendMessage(socket, {type: 'state', session: this.serializeSession(sessions.at(-1)!)})
      return
    }

    this.sendMessage(socket, {
      type: 'error',
      code: 'NO_SESSION',
      message: 'No pipeline session found'
    })
  }

  private handleSubscribe(socket: Socket): void {
    this.broadcast.addClient(socket)

    // Send current state snapshot if a job is running
    if (this.currentJobId) {
      const session = this.aggregator.getSession(this.currentJobId)
      if (session) {
        this.sendMessage(socket, {type: 'state', session: this.serializeSession(session)})
      }
    }
  }

  private handleCancel(socket: Socket): void {
    if (!this.running) {
      this.sendMessage(socket, {
        type: 'error',
        code: 'NOT_RUNNING',
        message: 'No pipeline is running'
      })
      return
    }

    // Signal cancellation — the pipeline runner will detect and abort
    this.sendMessage(socket, {type: 'ack', jobId: this.currentJobId ?? ''})
  }

  /** Convert SessionState.steps from Map to plain object for JSON serialization. */
  private serializeSession(session: SessionState): SerializedSessionState {
    return {
      ...session,
      steps: Object.fromEntries(session.steps)
    }
  }

  private sendMessage(socket: Socket, message: DaemonMessage): void {
    try {
      socket.write(JSON.stringify(message) + '\n')
    } catch {
      // Client disconnected
    }
  }

  private maybeScheduleShutdown(): void {
    if (this.running || this.broadcast.clientCount > 0) {
      return
    }

    this.shutdownTimer = setTimeout(() => {
      void this.stop()
    }, autoShutdownDelay)
  }
}
