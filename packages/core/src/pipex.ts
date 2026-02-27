import process from 'node:process'
import {randomUUID} from 'node:crypto'
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
import type {Kit, KitContext, Pipeline, PipelineDefinition, PipexConfig, Step} from './types.js'

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
  }): Promise<void> {
    return this.runner.run(pipeline, options)
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
    return this.stepRunner.run({
      workspace: ws,
      state,
      step,
      inputs,
      pipelineRoot,
      force: options?.force,
      ephemeral: options?.ephemeral,
      job
    })
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
      await Workspace.remove(this.workdir, name)
    }
  }

  async clean(): Promise<void> {
    const names = await Workspace.list(this.workdir)
    for (const name of names) {
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
