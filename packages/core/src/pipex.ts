import process from 'node:process'
import {fork} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DockerCliExecutor} from './engine/docker-executor.js'
import type {ContainerExecutor} from './engine/executor.js'
import {Workspace} from './engine/workspace.js'
import {PipelineLoader} from './pipeline-loader.js'
import {PipelineRunner} from './pipeline-runner.js'
import {StepRunner, type StepRunResult} from './step-runner.js'
import {ConsoleReporter, type Reporter, type JobContext} from './reporter.js'
import {StateManager} from './state.js'
import {PipexWorkspace, type WorkspaceInfo} from './pipex-workspace.js'
import {dirSize} from './utils.js'
import {DaemonError, type LockInfo} from './errors.js'
import type {Kit, KitContext, Pipeline, PipelineDefinition, PipexConfig, Step} from './types.js'
import {WorkspaceLock} from './daemon/workspace-lock.js'
import {DaemonClient} from './daemon/daemon-client.js'
import type {DaemonEntryMessage} from './daemon/daemon-entry.js'

export type PipexOptions = {
  runtime?: ContainerExecutor;
  reporter?: Reporter;
  workdir?: string;
  kits?: Kit[];
  config?: PipexConfig;
  cwd?: string;
}

export class Pipex {
  readonly loader: PipelineLoader
  readonly runner: PipelineRunner
  readonly stepRunner: StepRunner
  private readonly runtime: ContainerExecutor
  private readonly reporter: Reporter
  private readonly workdir: string
  private readonly config: PipexConfig
  private readonly cwd: string

  constructor(options: PipexOptions = {}) {
    const customKits = options.kits
      ? new Map(options.kits.map(k => [k.name, k]))
      : undefined
    const kitContext: KitContext = {
      config: options.config ?? {},
      cwd: options.cwd ?? process.cwd(),
      kits: customKits
    }
    this.runtime = options.runtime ?? new DockerCliExecutor()
    this.reporter = options.reporter ?? new ConsoleReporter()
    this.workdir = options.workdir ?? './workdir'
    this.config = options.config ?? {}
    this.cwd = options.cwd ?? process.cwd()
    this.loader = new PipelineLoader(kitContext)
    this.runner = new PipelineRunner(this.runtime, this.reporter, this.workdir)
    this.stepRunner = new StepRunner(this.runtime, this.reporter)
  }

  async load(input: string | PipelineDefinition): Promise<Pipeline> {
    return this.loader.load(input)
  }

  async loadStep(filePath: string, stepIdOverride?: string): Promise<Step> {
    return this.loader.loadStep(filePath, stepIdOverride)
  }

  async run(pipeline: Pipeline, options?: {
    workspace?: string;
    force?: true | string[];
    dryRun?: boolean;
    target?: string[];
    concurrency?: number;
    envFile?: string;
    /** @internal Skip workspace lock acquisition (used by DaemonServer which holds its own lock). */
    skipLock?: boolean;
  }): Promise<void> {
    if (options?.skipLock) {
      await this.runner.run(pipeline, options)
      return
    }

    const workspaceId = options?.workspace ?? pipeline.id

    // Ensure workspace exists with proper structure before acquiring lock
    try {
      await Workspace.open(this.workdir, workspaceId)
    } catch {
      await Workspace.create(this.workdir, workspaceId)
    }

    const workspaceRoot = join(this.workdir, workspaceId)
    const lock = await WorkspaceLock.acquire(workspaceRoot)
    try {
      await this.runner.run(pipeline, options)
    } finally {
      await lock.release()
    }
  }

  async exec(workspaceName: string, step: Step, options?: {
    inputs?: string[];
    ephemeral?: boolean;
    force?: boolean;
    pipelineRoot?: string;
  }): Promise<StepRunResult> {
    const pipelineRoot = options?.pipelineRoot ?? process.cwd()

    let ws: Workspace
    try {
      ws = await Workspace.open(this.workdir, workspaceName)
    } catch {
      ws = await Workspace.create(this.workdir, workspaceName)
    }

    const lock = await WorkspaceLock.acquire(ws.root)
    try {
      await ws.cleanupStaging()
      await this.runtime.check()
      await this.runtime.cleanupContainers(ws.id)

      const state = new StateManager(ws.root)
      await state.load()

      const inputs = new Map<string, string>()
      if (options?.inputs) {
        for (const spec of options.inputs) {
          const {alias, stepId} = parseInputSpec(spec)
          const stepState = state.getStep(stepId)
          if (!stepState) {
            throw new Error(`No run found for input step: ${stepId}`)
          }

          inputs.set(alias, stepState.runId)
        }
      }

      if (inputs.size > 0 && !step.inputs) {
        step.inputs = []
      }

      if (step.inputs) {
        for (const [alias] of inputs) {
          if (!step.inputs.some(i => i.step === alias)) {
            step.inputs.push({step: alias})
          }
        }
      }

      const job: JobContext = {workspaceId: ws.id, jobId: randomUUID()}
      return await this.stepRunner.run({
        workspace: ws,
        state,
        step,
        inputs,
        pipelineRoot,
        force: options?.force,
        ephemeral: options?.ephemeral,
        job
      })
    } finally {
      await lock.release()
    }
  }

  /**
   * Launches a pipeline in a detached daemon process.
   * Receives a fully resolved Pipeline so that relative paths
   * (sources, mounts) are resolved against the correct root.
   */
  async runDetached(pipeline: Pipeline, options?: {
    workspace?: string;
    force?: true | string[];
    target?: string[];
    concurrency?: number;
    envFile?: string;
  }): Promise<{jobId: string; workspaceId: string; pid: number; socketPath: string}> {
    const workspaceId = options?.workspace ?? pipeline.id
    const workspaceRoot = join(this.workdir, workspaceId)

    // Ensure workspace directory exists
    try {
      await Workspace.open(this.workdir, workspaceId)
    } catch {
      await Workspace.create(this.workdir, workspaceId)
    }

    const entryPath = join(
      fileURLToPath(new URL('.', import.meta.url)),
      'daemon',
      'daemon-entry.js'
    )

    const {socketPath, pid} = await new Promise<{socketPath: string; pid: number}>((resolve, reject) => {
      const child = fork(entryPath, [], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      })

      const message: DaemonEntryMessage = {
        workspaceRoot,
        pipexOptions: {
          workdir: this.workdir,
          config: this.config,
          cwd: this.cwd
        },
        config: this.config,
        cwd: this.cwd
      }

      child.send(message)

      child.once('message', (msg: {type: string; socketPath?: string; message?: string}) => {
        if (msg.type === 'ready') {
          child.unref()
          child.disconnect()
          resolve({socketPath: msg.socketPath!, pid: child.pid!})
        } else if (msg.type === 'error') {
          reject(new DaemonError(msg.message ?? 'Daemon failed to start'))
        }
      })

      child.once('error', error => {
        reject(new DaemonError('Failed to fork daemon process', {cause: error}))
      })

      child.once('exit', code => {
        if (code !== null && code !== 0) {
          reject(new DaemonError(`Daemon exited with code ${code}`))
        }
      })
    })

    // Send the resolved pipeline — no re-loading needed in the daemon
    const client = await DaemonClient.connect(socketPath)
    const jobId = await client.run(pipeline, {
      workspace: options?.workspace,
      force: options?.force,
      target: options?.target,
      concurrency: options?.concurrency,
      envFile: options?.envFile
    })
    await client.disconnect()

    return {jobId, workspaceId, pid, socketPath}
  }

  /**
   * Attaches to a running daemon on the given workspace.
   * Returns a DaemonClient subscribed to the event stream.
   */
  async attach(workspaceName: string): Promise<DaemonClient> {
    const workspaceRoot = join(this.workdir, workspaceName)
    const lockInfo = await WorkspaceLock.check(workspaceRoot)

    if (!lockInfo) {
      throw new DaemonError(`No running daemon for workspace "${workspaceName}"`)
    }

    const client = await DaemonClient.connect(lockInfo.socketPath)
    await client.subscribe()
    return client
  }

  /**
   * Checks if a workspace is locked.
   * Returns LockInfo if locked, null otherwise.
   */
  async workspaceLock(workspaceName: string): Promise<LockInfo | undefined> {
    const workspaceRoot = join(this.workdir, workspaceName)
    return WorkspaceLock.check(workspaceRoot)
  }

  async workspace(name: string): Promise<PipexWorkspace> {
    const ws = await Workspace.open(this.workdir, name)
    const state = new StateManager(ws.root)
    await state.load()
    return new PipexWorkspace(ws, state)
  }

  async workspaces(): Promise<WorkspaceInfo[]> {
    const names = await Workspace.list(this.workdir)
    const results: WorkspaceInfo[] = []

    for (const name of names) {
      const ws = await Workspace.open(this.workdir, name)
      const runs = await ws.listRuns()
      const caches = await ws.listCaches()
      const size = await dirSize(ws.root)
      results.push({name, runs: runs.length, caches: caches.length, size})
    }

    return results
  }

  async removeWorkspace(...names: string[]): Promise<void> {
    const existing = await Workspace.list(this.workdir)
    for (const name of names) {
      if (!existing.includes(name)) {
        throw new Error(`Workspace not found: ${name}`)
      }
    }

    for (const name of names) {
      const workspaceRoot = join(this.workdir, name)
      const lockInfo = await WorkspaceLock.check(workspaceRoot)
      if (lockInfo) {
        throw new DaemonError(`Cannot remove workspace "${name}": locked by process ${lockInfo.pid}`)
      }

      await Workspace.remove(this.workdir, name)
    }
  }

  async clean(): Promise<void> {
    const names = await Workspace.list(this.workdir)
    for (const name of names) {
      const workspaceRoot = join(this.workdir, name)
      const lockInfo = await WorkspaceLock.check(workspaceRoot)
      if (lockInfo) {
        this.reporter.emit({
          event: 'STEP_LOG',
          workspaceId: name,
          jobId: '',
          step: {id: '', displayName: ''},
          stream: 'stderr',
          line: `Skipping locked workspace "${name}" (pid ${lockInfo.pid})`
        })
        continue
      }

      await Workspace.remove(this.workdir, name)
    }
  }
}

function parseInputSpec(spec: string): {alias: string; stepId: string} {
  const eqIdx = spec.indexOf('=')
  if (eqIdx > 0) {
    return {alias: spec.slice(0, eqIdx), stepId: spec.slice(eqIdx + 1)}
  }

  return {alias: spec, stepId: spec}
}
