import {cp} from 'node:fs/promises'
import {basename, dirname, resolve} from 'node:path'
import {Workspace, type ContainerExecutor, type InputMount, type OutputMount, type CacheMount, type BindMount} from '../engine/index.js'
import type {Reporter} from './reporter.js'
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
 *    a. Computes fingerprint (image + cmd + env + input artifact IDs)
 *    b. Checks cache (fingerprint match + artifact exists)
 *    c. If cached: skips execution
 *    d. If not cached: resolves inputs, prepares staging, executes container
 *    e. On success: commits artifact, saves state
 *    f. On failure: discards artifact, halts pipeline (unless allowFailure)
 * 4. **Completion**: Reports final pipeline status
 *
 * ## Dependencies
 *
 * Steps declare dependencies via `inputs: [{step: "stepId"}]`.
 * The runner:
 * - Mounts input artifacts as read-only volumes
 * - Optionally copies inputs to output staging (if `copyToOutput: true`)
 * - Tracks execution order to resolve step names to artifact IDs
 *
 * ## Caching
 *
 * Cache invalidation is automatic:
 * - Changing a step's configuration re-runs it
 * - Re-running a step invalidates all dependent steps
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

    // Workspace ID priority: CLI arg > config.name > filename
    const workspaceId = workspaceName
      ?? config.name
      ?? basename(pipelineFilePath).replace(/\.[^.]+$/, '').replaceAll(/[^\w-]/g, '-')

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
    const stepArtifacts = new Map<string, string>()

    this.reporter.state(workspace.id, 'PIPELINE_START')

    for (const step of config.steps) {
      const inputArtifactIds = step.inputs
        ?.map(i => stepArtifacts.get(i.step))
        .filter((id): id is string => id !== undefined)
      const resolvedMounts = step.mounts?.map(m => ({
        hostPath: resolve(pipelineRoot, m.host),
        containerPath: m.container
      }))
      const currentFingerprint = StateManager.fingerprint({
        image: step.image,
        cmd: step.cmd,
        env: step.env,
        inputArtifactIds,
        mounts: resolvedMounts
      })

      const skipCache = force === true || (Array.isArray(force) && force.includes(step.id))
      if (!skipCache && await this.tryUseCache({workspace, state, step, currentFingerprint, stepArtifacts})) {
        continue
      }

      this.reporter.state(workspace.id, 'STEP_STARTING', step.id)

      const artifactId = workspace.generateArtifactId()
      const stagingPath = await workspace.prepareArtifact(artifactId)

      await this.prepareStagingWithInputs(workspace, step, stagingPath, stepArtifacts)

      // Prepare caches
      if (step.caches) {
        for (const cache of step.caches) {
          await workspace.prepareCache(cache.name)
        }
      }

      const {inputs, output, caches, mounts} = this.buildMounts(step, artifactId, stepArtifacts, pipelineRoot)

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
          network: step.allowNetwork ? 'bridge' : 'none',
          timeoutSec: step.timeoutSec
        },
        ({stream, line}) => {
          this.reporter.log(workspace.id, step.id, stream, line)
        }
      )

      this.reporter.result(workspace.id, step.id, result)

      if (result.exitCode === 0 || step.allowFailure) {
        await workspace.commitArtifact(artifactId)
        stepArtifacts.set(step.id, artifactId)

        state.setStep(step.id, artifactId, currentFingerprint)
        await state.save()

        this.reporter.state(workspace.id, 'STEP_FINISHED', step.id, {artifactId})
      } else {
        await workspace.discardArtifact(artifactId)
        this.reporter.state(workspace.id, 'STEP_FAILED', step.id, {exitCode: result.exitCode})
        this.reporter.state(workspace.id, 'PIPELINE_FAILED')
        throw new Error(`Step ${step.id} failed with exit code ${result.exitCode}`)
      }
    }

    this.reporter.state(workspace.id, 'PIPELINE_FINISHED')
  }

  private async tryUseCache({
    workspace,
    state,
    step,
    currentFingerprint,
    stepArtifacts
  }: {
    workspace: Workspace;
    state: StateManager;
    step: {id: string};
    currentFingerprint: string;
    stepArtifacts: Map<string, string>;
  }): Promise<boolean> {
    const cached = state.getStep(step.id)
    if (cached?.fingerprint === currentFingerprint) {
      try {
        const artifacts = await workspace.listArtifacts()
        if (artifacts.includes(cached.artifactId)) {
          stepArtifacts.set(step.id, cached.artifactId)
          this.reporter.state(workspace.id, 'STEP_SKIPPED', step.id, {artifactId: cached.artifactId, reason: 'cached'})
          return true
        }
      } catch {
        // Artifact missing, proceed with execution
      }
    }

    return false
  }

  private async prepareStagingWithInputs(
    workspace: Workspace,
    step: {id: string; inputs?: Array<{step: string; copyToOutput?: boolean}>},
    stagingPath: string,
    stepArtifacts: Map<string, string>
  ): Promise<void> {
    if (!step.inputs) {
      return
    }

    for (const input of step.inputs) {
      const inputArtifactId = stepArtifacts.get(input.step)
      if (!inputArtifactId) {
        throw new Error(`Step ${step.id}: input step '${input.step}' not found or not yet executed`)
      }

      if (input.copyToOutput) {
        await cp(workspace.artifactPath(inputArtifactId), stagingPath, {recursive: true})
      }
    }
  }

  private buildMounts(
    step: {inputs?: Array<{step: string}>; outputPath?: string; caches?: Array<{name: string; path: string}>; mounts?: Array<{host: string; container: string}>},
    outputArtifactId: string,
    stepArtifacts: Map<string, string>,
    pipelineRoot: string
  ): {inputs: InputMount[]; output: OutputMount; caches?: CacheMount[]; mounts?: BindMount[]} {
    const inputs: InputMount[] = []

    if (step.inputs) {
      for (const input of step.inputs) {
        const inputArtifactId = stepArtifacts.get(input.step)
        if (inputArtifactId) {
          inputs.push({
            artifactId: inputArtifactId,
            containerPath: `/input/${input.step}`
          })
        }
      }
    }

    const output: OutputMount = {
      stagingArtifactId: outputArtifactId,
      containerPath: step.outputPath ?? '/output'
    }

    // Build cache mounts
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
