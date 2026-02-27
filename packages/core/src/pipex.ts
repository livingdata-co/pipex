import process from 'node:process'
import {DockerCliExecutor} from './engine/docker-executor.js'
import type {ContainerExecutor} from './engine/executor.js'
import {PipelineLoader} from './pipeline-loader.js'
import {PipelineRunner} from './pipeline-runner.js'
import {StepRunner} from './step-runner.js'
import {ConsoleReporter, type Reporter} from './reporter.js'
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

  constructor(options: PipexOptions = {}) {
    const customKits = options.kits
      ? new Map(options.kits.map(k => [k.name, k]))
      : undefined
    const kitContext: KitContext = {
      config: options.config ?? {},
      cwd: options.cwd ?? process.cwd(),
      kits: customKits
    }
    const runtime = options.runtime ?? new DockerCliExecutor()
    const reporter = options.reporter ?? new ConsoleReporter()
    this.loader = new PipelineLoader(kitContext)
    this.runner = new PipelineRunner(runtime, reporter, options.workdir ?? './workdir')
    this.stepRunner = new StepRunner(runtime, reporter)
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
}
