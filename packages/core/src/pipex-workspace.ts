import process from 'node:process'
import {cp, readdir, readFile, rm, stat} from 'node:fs/promises'
import {join} from 'node:path'
import type {Workspace} from './engine/workspace.js'
import {ArtifactNotFoundError, StepNotFoundError} from './errors.js'
import {type StateManager} from './state.js'
import {dirSize} from './utils.js'

export type WorkspaceInfo = {
  name: string;
  runs: number;
  caches: number;
  size: number;
}

export type StepInfo = {
  stepId: string;
  runId?: string;
  status: 'success' | 'failure' | 'running' | 'unknown';
  stepName?: string;
  durationMs?: number;
  artifactSize?: number;
  finishedAt?: string;
  startedAt?: string;
}

export type RunMeta = Record<string, unknown>

export type ArtifactEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

export class PipexWorkspace {
  constructor(
    private readonly ws: Workspace,
    private readonly state: StateManager
  ) {}

  get name(): string {
    return this.ws.id
  }

  get root(): string {
    return this.ws.root
  }

  async show(): Promise<StepInfo[]> {
    const committed = this.state.listSteps()
    const running = await this.ws.listRunningSteps()

    const activeRunning = new Map<string, typeof running[number]>()
    for (const r of running) {
      if (isProcessAlive(r.pid)) {
        activeRunning.set(r.stepId, r)
      }
    }

    const rows: StepInfo[] = []

    for (const step of committed) {
      if (activeRunning.has(step.stepId)) {
        const r = activeRunning.get(step.stepId)!
        activeRunning.delete(step.stepId)
        rows.push({
          stepId: step.stepId,
          stepName: r.stepName,
          status: 'running',
          startedAt: r.startedAt
        })
        continue
      }

      const meta = await this.loadMeta(step.runId)
      if (meta) {
        const artifactSize = await dirSize(this.ws.runArtifactsPath(step.runId))
        rows.push({
          stepId: step.stepId,
          runId: step.runId,
          stepName: meta.stepName as string | undefined,
          status: (meta.status as 'success' | 'failure') ?? 'unknown',
          durationMs: meta.durationMs as number | undefined,
          artifactSize,
          finishedAt: meta.finishedAt as string | undefined
        })
      } else {
        rows.push({
          stepId: step.stepId,
          runId: step.runId,
          status: 'unknown'
        })
      }
    }

    for (const [, r] of activeRunning) {
      rows.push({
        stepId: r.stepId,
        stepName: r.stepName,
        status: 'running',
        startedAt: r.startedAt
      })
    }

    return rows
  }

  async logs(stepId: string, stream?: 'stdout' | 'stderr'): Promise<string> {
    const runId = this.resolveRunId(stepId)
    const runDir = this.ws.runPath(runId)
    const parts: string[] = []

    if (!stream || stream === 'stdout') {
      try {
        parts.push(await readFile(join(runDir, 'stdout.log'), 'utf8'))
      } catch {
        // No stdout log
      }
    }

    if (!stream || stream === 'stderr') {
      try {
        parts.push(await readFile(join(runDir, 'stderr.log'), 'utf8'))
      } catch {
        // No stderr log
      }
    }

    return parts.join('')
  }

  async inspect(stepId: string): Promise<RunMeta> {
    const runId = this.resolveRunId(stepId)
    const metaPath = join(this.ws.runPath(runId), 'meta.json')
    const content = await readFile(metaPath, 'utf8')
    return JSON.parse(content) as RunMeta
  }

  async listArtifacts(stepId: string, path?: string): Promise<ArtifactEntry[]> {
    const runId = this.resolveRunId(stepId)
    const artifactsDir = this.ws.runArtifactsPath(runId)
    const targetPath = path ? join(artifactsDir, path) : artifactsDir

    if (!targetPath.startsWith(artifactsDir)) {
      throw new ArtifactNotFoundError('Invalid path: must be within artifacts directory')
    }

    const entries = await readdir(targetPath, {withFileTypes: true})
    const results: ArtifactEntry[] = []

    for (const entry of entries) {
      const fullPath = join(targetPath, entry.name)
      const info = await stat(fullPath)
      results.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isDirectory() ? 0 : info.size
      })
    }

    return results
  }

  async readArtifact(stepId: string, path: string): Promise<Uint8Array> {
    const runId = this.resolveRunId(stepId)
    const artifactsDir = this.ws.runArtifactsPath(runId)
    const targetPath = join(artifactsDir, path)

    if (!targetPath.startsWith(artifactsDir)) {
      throw new ArtifactNotFoundError('Invalid path: must be within artifacts directory')
    }

    return readFile(targetPath)
  }

  async exportArtifacts(stepId: string, dest: string): Promise<void> {
    const runId = this.resolveRunId(stepId)
    const artifactsPath = this.ws.runArtifactsPath(runId)
    await cp(artifactsPath, dest, {recursive: true})
  }

  async prune(): Promise<{removed: number; freedBytes: number}> {
    const activeIds = this.state.activeRunIds()
    const allRuns = await this.ws.listRuns()

    let freedBytes = 0
    for (const runId of allRuns) {
      if (!activeIds.has(runId)) {
        freedBytes += await dirSize(this.ws.runPath(runId))
      }
    }

    const removed = await this.ws.pruneRuns(activeIds)
    return {removed, freedBytes}
  }

  async removeStep(stepId: string): Promise<void> {
    const runId = this.resolveRunId(stepId)

    await rm(this.ws.runPath(runId), {recursive: true, force: true})
    await rm(join(this.ws.root, 'step-runs', stepId), {force: true})

    this.state.removeStep(stepId)
    await this.state.save()
  }

  async remove(): Promise<void> {
    await rm(this.ws.root, {recursive: true, force: true})
  }

  private resolveRunId(stepId: string): string {
    const stepState = this.state.getStep(stepId)
    if (!stepState) {
      throw new StepNotFoundError(stepId, stepId)
    }

    return stepState.runId
  }

  private async loadMeta(runId: string): Promise<RunMeta | undefined> {
    try {
      const content = await readFile(join(this.ws.runPath(runId), 'meta.json'), 'utf8')
      return JSON.parse(content) as RunMeta
    } catch {
      return undefined
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
