import {cp, writeFile} from 'node:fs/promises'
import {createWriteStream, type WriteStream} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {Workspace, type ContainerExecutor, type InputMount, type OutputMount, type CacheMount, type BindMount} from '../engine/index.js'
import type {Step} from '../types.js'
import type {Reporter, StepRef} from './reporter.js'
import type {PipelineLoader} from './pipeline-loader.js'
import {StateManager} from './state.js'

/**
 * Orchestrates pipeline execution with dependency resolution and caching.
 *
 * ## Workflow
 *
 * 1. **Workspace Resolution**: Determines workspace ID from CLI flag, config, or filename
 * 2. **State Loading**: Loads cached fingerprints from state.json
 * 3. **Step Execution**: For each step:
 *    a. Computes fingerprint (image + cmd + env + input run IDs)
 *    b. Checks cache (fingerprint match + run exists)
 *    c. If cached: skips execution
 *    d. If not cached: resolves inputs, prepares staging, executes container
 *    e. On success: writes meta.json, commits run, saves state
 *    f. On failure: discards run, halts pipeline (unless allowFailure)
 * 4. **Completion**: Reports final pipeline status
 *
 * ## Runs
 *
 * Each step execution produces a **run** containing:
 * - `artifacts/` — files produced by the step
 * - `stdout.log` / `stderr.log` — captured container logs
 * - `meta.json` — structured execution metadata
 */
export class PipelineRunner {
  constructor(
    private readonly loader: PipelineLoader,
    private readonly runtime: ContainerExecutor,
    private readonly reporter: Reporter,
    private readonly workdirRoot: string
  ) {}

  async run(pipelineFilePath: string, options?: {workspace?: string; force?: true | string[]}): Promise<void> {
    const {workspace: workspaceName, force} = options ?? {}
    const config = await this.loader.load(pipelineFilePath)
    const pipelineRoot = dirname(resolve(pipelineFilePath))

    const workspaceId = workspaceName ?? config.id

    let workspace: Workspace
    try {
      workspace = await Workspace.open(this.workdirRoot, workspaceId)
    } catch {
      workspace = await Workspace.create(this.workdirRoot, workspaceId)
    }

    await workspace.cleanupStaging()
    await this.runtime.check()

    const state = new StateManager(workspace.root)
    await state.load()
    const stepRuns = new Map<string, string>()

    this.reporter.state(workspace.id, 'PIPELINE_START', undefined, {pipelineName: config.name ?? config.id})

    for (const step of config.steps) {
      const stepRef: StepRef = {id: step.id, displayName: step.name ?? step.id}
      const inputRunIds = step.inputs
        ?.map(i => stepRuns.get(i.step))
        .filter((id): id is string => id !== undefined)
      const resolvedMounts = step.mounts?.map(m => ({
        hostPath: resolve(pipelineRoot, m.host),
        containerPath: m.container
      }))
      const currentFingerprint = StateManager.fingerprint({
        image: step.image,
        cmd: step.cmd,
        env: step.env,
        inputRunIds,
        mounts: resolvedMounts
      })

      const skipCache = force === true || (Array.isArray(force) && force.includes(step.id))
      if (!skipCache && await this.tryUseCache({workspace, state, step, stepRef, currentFingerprint, stepRuns})) {
        continue
      }

      this.reporter.state(workspace.id, 'STEP_STARTING', stepRef)
      await this.executeStep({workspace, state, step, stepRef, stepRuns, currentFingerprint, resolvedMounts, pipelineRoot})
    }

    this.reporter.state(workspace.id, 'PIPELINE_FINISHED')
  }

  private async executeStep({workspace, state, step, stepRef, stepRuns, currentFingerprint, resolvedMounts, pipelineRoot}: {
    workspace: Workspace;
    state: StateManager;
    step: Step;
    stepRef: StepRef;
    stepRuns: Map<string, string>;
    currentFingerprint: string;
    resolvedMounts?: Array<{hostPath: string; containerPath: string}>;
    pipelineRoot: string;
  }): Promise<void> {
    const runId = workspace.generateRunId()
    const stagingPath = await workspace.prepareRun(runId)

    await this.prepareStagingWithInputs(workspace, step, workspace.runStagingArtifactsPath(runId), stepRuns)

    if (step.caches) {
      for (const cache of step.caches) {
        await workspace.prepareCache(cache.name)
      }
    }

    const {inputs, output, caches, mounts} = this.buildMounts(step, runId, stepRuns, pipelineRoot)

    const stdoutLog = createWriteStream(join(stagingPath, 'stdout.log'))
    const stderrLog = createWriteStream(join(stagingPath, 'stderr.log'))

    try {
      const result = await this.runtime.run(
        workspace,
        {
          name: `pipex-${workspace.id}-${step.id}-${Date.now()}`,
          image: step.image,
          cmd: step.cmd,
          env: step.env,
          inputs,
          output,
          caches,
          mounts,
          sources: step.sources?.map(m => ({
            hostPath: resolve(pipelineRoot, m.host),
            containerPath: m.container
          })),
          network: step.allowNetwork ? 'bridge' : 'none',
          timeoutSec: step.timeoutSec
        },
        ({stream, line}) => {
          if (stream === 'stdout') {
            stdoutLog.write(line + '\n')
          } else {
            stderrLog.write(line + '\n')
          }

          this.reporter.log(workspace.id, stepRef, stream, line)
        }
      )

      this.reporter.result(workspace.id, stepRef, result)

      await closeStream(stdoutLog)
      await closeStream(stderrLog)

      await this.writeRunMeta(stagingPath, {runId, step, stepRuns, resolvedMounts, currentFingerprint, result})

      if (result.exitCode === 0 || step.allowFailure) {
        await workspace.commitRun(runId)
        await workspace.linkRun(step.id, runId)
        stepRuns.set(step.id, runId)

        state.setStep(step.id, runId, currentFingerprint)
        await state.save()

        this.reporter.state(workspace.id, 'STEP_FINISHED', stepRef, {runId})
      } else {
        await workspace.discardRun(runId)
        this.reporter.state(workspace.id, 'STEP_FAILED', stepRef, {exitCode: result.exitCode})
        this.reporter.state(workspace.id, 'PIPELINE_FAILED')
        throw new Error(`Step ${step.id} failed with exit code ${result.exitCode}`)
      }
    } catch (error) {
      await closeStream(stdoutLog)
      await closeStream(stderrLog)
      throw error
    }
  }

  private async writeRunMeta(stagingPath: string, {runId, step, stepRuns, resolvedMounts, currentFingerprint, result}: {
    runId: string;
    step: Step;
    stepRuns: Map<string, string>;
    resolvedMounts?: Array<{hostPath: string; containerPath: string}>;
    currentFingerprint: string;
    result: {exitCode: number; startedAt: Date; finishedAt: Date};
  }): Promise<void> {
    const meta = {
      runId,
      stepId: step.id,
      stepName: step.name,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      durationMs: result.finishedAt.getTime() - result.startedAt.getTime(),
      exitCode: result.exitCode,
      image: step.image,
      cmd: step.cmd,
      env: step.env,
      inputs: step.inputs?.map(i => ({
        step: i.step,
        runId: stepRuns.get(i.step),
        mountedAs: `/input/${i.step}`
      })),
      mounts: resolvedMounts,
      caches: step.caches?.map(c => c.name),
      allowNetwork: step.allowNetwork ?? false,
      fingerprint: currentFingerprint,
      status: result.exitCode === 0 ? 'success' : 'failure'
    }
    await writeFile(join(stagingPath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  }

  private async tryUseCache({
    workspace,
    state,
    step,
    stepRef,
    currentFingerprint,
    stepRuns
  }: {
    workspace: Workspace;
    state: StateManager;
    step: {id: string; name?: string};
    stepRef: StepRef;
    currentFingerprint: string;
    stepRuns: Map<string, string>;
  }): Promise<boolean> {
    const cached = state.getStep(step.id)
    if (cached?.fingerprint === currentFingerprint) {
      try {
        const runs = await workspace.listRuns()
        if (runs.includes(cached.runId)) {
          stepRuns.set(step.id, cached.runId)
          await workspace.linkRun(step.id, cached.runId)
          this.reporter.state(workspace.id, 'STEP_SKIPPED', stepRef, {runId: cached.runId, reason: 'cached'})
          return true
        }
      } catch {
        // Run missing, proceed with execution
      }
    }

    return false
  }

  private async prepareStagingWithInputs(
    workspace: Workspace,
    step: {id: string; inputs?: Array<{step: string; copyToOutput?: boolean}>},
    stagingArtifactsPath: string,
    stepRuns: Map<string, string>
  ): Promise<void> {
    if (!step.inputs) {
      return
    }

    for (const input of step.inputs) {
      const inputRunId = stepRuns.get(input.step)
      if (!inputRunId) {
        throw new Error(`Step ${step.id}: input step '${input.step}' not found or not yet executed`)
      }

      if (input.copyToOutput) {
        await cp(workspace.runArtifactsPath(inputRunId), stagingArtifactsPath, {recursive: true})
      }
    }
  }

  private buildMounts(
    step: {inputs?: Array<{step: string}>; outputPath?: string; caches?: Array<{name: string; path: string}>; mounts?: Array<{host: string; container: string}>},
    outputRunId: string,
    stepRuns: Map<string, string>,
    pipelineRoot: string
  ): {inputs: InputMount[]; output: OutputMount; caches?: CacheMount[]; mounts?: BindMount[]} {
    const inputs: InputMount[] = []

    if (step.inputs) {
      for (const input of step.inputs) {
        const inputRunId = stepRuns.get(input.step)
        if (inputRunId) {
          inputs.push({
            runId: inputRunId,
            containerPath: `/input/${input.step}`
          })
        }
      }
    }

    const output: OutputMount = {
      stagingRunId: outputRunId,
      containerPath: step.outputPath ?? '/output'
    }

    let caches: CacheMount[] | undefined
    if (step.caches) {
      caches = step.caches.map(c => ({
        name: c.name,
        containerPath: c.path
      }))
    }

    let mounts: BindMount[] | undefined
    if (step.mounts) {
      mounts = step.mounts.map(m => ({
        hostPath: resolve(pipelineRoot, m.host),
        containerPath: m.container
      }))
    }

    return {inputs, output, caches, mounts}
  }
}

async function closeStream(stream: WriteStream): Promise<void> {
  if (stream.destroyed) {
    return
  }

  return new Promise((resolve, reject) => {
    stream.end(() => {
      resolve()
    })
    stream.on('error', reject)
  })
}
