import {access, mkdir, readdir, rename, rm, symlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {WorkspaceError, StagingError} from '../errors.js'

/**
 * Isolated execution environment for container runs.
 *
 * A workspace provides:
 * - **staging/**: Temporary write location during execution
 * - **runs/**: Committed run outputs (immutable, read-only)
 * - **caches/**: Persistent read-write caches (shared across steps)
 * - **state.json**: Managed by orchestration layer (e.g., CLI) for caching
 *
 * ## Run Lifecycle
 *
 * Each step execution produces a **run**, a structured directory containing
 * artifacts (files produced by the step), logs (stdout/stderr), and metadata.
 *
 * 1. `prepareRun()` creates `staging/{runId}/` with `artifacts/` subdirectory
 * 2. Container writes to `staging/{runId}/artifacts/` (mounted as `/output`)
 * 3. Orchestration layer writes logs and metadata to `staging/{runId}/`
 * 4. Success: `commitRun()` atomically moves to `runs/{runId}/`
 *    OR Failure: `discardRun()` deletes `staging/{runId}/`
 *
 * Runs are immutable once committed.
 *
 * ## Cache Lifecycle
 *
 * 1. `prepareCache()` creates `caches/{name}/` if it doesn't exist
 * 2. Container writes/reads from `caches/{name}/` during execution
 * 3. Cache persists across executions (never deleted automatically)
 *
 * Caches are mutable and shared between steps.
 *
 * @example
 * ```typescript
 * const ws = await Workspace.create('/tmp/workdir', 'my-workspace')
 * const runId = ws.generateRunId()
 * await ws.prepareRun(runId)
 * await ws.prepareCache('pnpm-store')
 * // ... container execution ...
 * await ws.commitRun(runId) // On success
 * // OR await ws.discardRun(runId) // On failure
 * ```
 */
export class Workspace {
  /**
   * Generates a unique workspace identifier.
   * @returns Workspace ID in format: `{timestamp}-{uuid-prefix}`
   */
  static generateWorkspaceId(): string {
    return Workspace.generateId()
  }

  /**
   * Creates a new workspace with staging, runs, and caches directories.
   * @param workdirRoot - Root directory for all workspaces
   * @param id - Optional workspace ID (auto-generated if omitted)
   * @returns Newly created workspace
   */
  static async create(workdirRoot: string, id?: string): Promise<Workspace> {
    const workspaceId = id ?? Workspace.generateWorkspaceId()
    const root = join(workdirRoot, workspaceId)
    await mkdir(join(root, 'staging'), {recursive: true})
    await mkdir(join(root, 'runs'), {recursive: true})
    await mkdir(join(root, 'caches'), {recursive: true})
    return new Workspace(workspaceId, root)
  }

  /**
   * Opens an existing workspace.
   * @param workdirRoot - Root directory for all workspaces
   * @param id - Workspace ID
   * @returns Existing workspace
   * @throws If workspace does not exist
   */
  static async open(workdirRoot: string, id: string): Promise<Workspace> {
    const root = join(workdirRoot, id)
    await access(root)
    return new Workspace(id, root)
  }

  /**
   * Lists all workspace IDs under the given root directory.
   * @param workdirRoot - Root directory for all workspaces
   * @returns Sorted array of workspace names (directories)
   */
  static async list(workdirRoot: string): Promise<string[]> {
    try {
      const entries = await readdir(workdirRoot, {withFileTypes: true})
      return entries.filter(e => e.isDirectory()).map(e => e.name).sort()
    } catch {
      return []
    }
  }

  /**
   * Removes a workspace directory.
   * @param workdirRoot - Root directory for all workspaces
   * @param id - Workspace ID to remove
   * @throws If the workspace ID is invalid
   */
  static async remove(workdirRoot: string, id: string): Promise<void> {
    if (id.includes('..') || id.includes('/')) {
      throw new WorkspaceError('INVALID_WORKSPACE_ID', `Invalid workspace ID: ${id}`)
    }

    await rm(join(workdirRoot, id), {recursive: true, force: true})
  }

  /**
   * Generates a unique identifier using timestamp and UUID.
   * @returns Unique ID in format: `{timestamp}-{uuid-prefix}`
   * @internal
   */
  private static generateId(): string {
    return `${Date.now()}-${randomUUID().slice(0, 8)}`
  }

  private constructor(
    readonly id: string,
    readonly root: string
  ) {}

  /**
   * Generates a unique run identifier.
   * @returns Run ID in format: `{timestamp}-{uuid-prefix}`
   */
  generateRunId(): string {
    return Workspace.generateId()
  }

  /**
   * Returns the staging directory path for a run.
   * @param runId - Run identifier
   * @returns Absolute path to staging directory
   */
  runStagingPath(runId: string): string {
    this.validateRunId(runId)
    return join(this.root, 'staging', runId)
  }

  /**
   * Returns the staging artifacts directory path for a run.
   * @param runId - Run identifier
   * @returns Absolute path to staging artifacts directory
   */
  runStagingArtifactsPath(runId: string): string {
    return join(this.runStagingPath(runId), 'artifacts')
  }

  /**
   * Returns the committed run directory path.
   * @param runId - Run identifier
   * @returns Absolute path to run directory
   */
  runPath(runId: string): string {
    this.validateRunId(runId)
    return join(this.root, 'runs', runId)
  }

  /**
   * Returns the artifacts directory path within a committed run.
   * @param runId - Run identifier
   * @returns Absolute path to run artifacts directory
   */
  runArtifactsPath(runId: string): string {
    return join(this.runPath(runId), 'artifacts')
  }

  /**
   * Prepares a staging directory for a new run.
   * Creates both the run directory and its artifacts subdirectory.
   * @param runId - Run identifier
   * @returns Absolute path to the created staging directory
   */
  async prepareRun(runId: string): Promise<string> {
    try {
      const path = this.runStagingPath(runId)
      await mkdir(path, {recursive: true})
      await mkdir(join(path, 'artifacts'), {recursive: true})
      return path
    } catch (error) {
      throw new StagingError(`Failed to prepare run ${runId}`, {cause: error})
    }
  }

  /**
   * Commits a staging run to the runs directory.
   * Uses atomic rename operation for consistency.
   * @param runId - Run identifier
   */
  async commitRun(runId: string): Promise<void> {
    try {
      await rename(this.runStagingPath(runId), this.runPath(runId))
    } catch (error) {
      throw new StagingError(`Failed to commit run ${runId}`, {cause: error})
    }
  }

  /**
   * Creates a symlink from `step-runs/{stepId}` to the committed run.
   * Replaces any existing symlink for the same step.
   * @param stepId - Step identifier
   * @param runId - Committed run identifier
   */
  async linkRun(stepId: string, runId: string): Promise<void> {
    const dir = join(this.root, 'step-runs')
    await mkdir(dir, {recursive: true})
    const linkPath = join(dir, stepId)
    await rm(linkPath, {force: true})
    await symlink(join('..', 'runs', runId), linkPath)
  }

  /**
   * Discards a staging run (on execution failure).
   * @param runId - Run identifier
   */
  async discardRun(runId: string): Promise<void> {
    try {
      await rm(this.runStagingPath(runId), {recursive: true, force: true})
    } catch (error) {
      throw new StagingError(`Failed to discard run ${runId}`, {cause: error})
    }
  }

  /**
   * Removes all staging directories.
   * Should be called on workspace initialization to clean up incomplete runs.
   */
  async cleanupStaging(): Promise<void> {
    const stagingDir = join(this.root, 'staging')
    try {
      const entries = await readdir(stagingDir, {withFileTypes: true})
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await rm(join(stagingDir, entry.name), {recursive: true, force: true})
        }
      }
    } catch {
      // Staging directory doesn't exist yet
    }
  }

  /**
   * Lists all committed run IDs in this workspace.
   * @returns Array of run IDs (directory names in runs/)
   */
  async listRuns(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.root, 'runs'), {withFileTypes: true})
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      return []
    }
  }

  /**
   * Removes runs not in the given set of active run IDs.
   * @param activeRunIds - Set of run IDs to keep
   * @returns Number of runs removed
   */
  async pruneRuns(activeRunIds: Set<string>): Promise<number> {
    const allRuns = await this.listRuns()
    let removed = 0
    for (const runId of allRuns) {
      if (!activeRunIds.has(runId)) {
        await rm(join(this.root, 'runs', runId), {recursive: true, force: true})
        removed++
      }
    }

    return removed
  }

  /**
   * Returns the cache directory path.
   * Caches are persistent read-write directories shared across steps.
   * @param cacheName - Cache identifier (e.g., "pnpm-store")
   * @returns Absolute path to cache directory
   * @throws If cache name is invalid
   */
  cachePath(cacheName: string): string {
    this.validateCacheName(cacheName)
    return join(this.root, 'caches', cacheName)
  }

  /**
   * Prepares a cache directory.
   * Creates the directory if it doesn't exist.
   * @param cacheName - Cache identifier
   * @returns Absolute path to the cache directory
   */
  async prepareCache(cacheName: string): Promise<string> {
    const path = this.cachePath(cacheName)
    await mkdir(path, {recursive: true})
    return path
  }

  /**
   * Lists all cache directories in the workspace.
   * @returns Array of cache names
   */
  async listCaches(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.root, 'caches'), {withFileTypes: true})
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      return []
    }
  }

  /**
   * Validates a run ID to prevent path traversal attacks.
   * @param id - Run identifier to validate
   * @throws If the run ID contains invalid characters or path traversal attempts
   * @internal
   */
  private validateRunId(id: string): void {
    if (!/^[\w-]+$/.test(id)) {
      throw new WorkspaceError('INVALID_RUN_ID', `Invalid run ID: ${id}. Must contain only alphanumeric characters, dashes, and underscores.`)
    }

    if (id.includes('..')) {
      throw new WorkspaceError('INVALID_RUN_ID', `Invalid run ID: ${id}. Path traversal is not allowed.`)
    }
  }

  /**
   * Validates a cache name to prevent path traversal attacks.
   * Same rules as run IDs: alphanumeric, dashes, underscores only.
   * @param name - Cache name to validate
   * @throws If the cache name contains invalid characters or path traversal attempts
   * @internal
   */
  private validateCacheName(name: string): void {
    if (!/^[\w-]+$/.test(name)) {
      throw new WorkspaceError('INVALID_CACHE_NAME', `Invalid cache name: ${name}. Must contain only alphanumeric characters, dashes, and underscores.`)
    }

    if (name.includes('..')) {
      throw new WorkspaceError('INVALID_CACHE_NAME', `Invalid cache name: ${name}. Path traversal is not allowed.`)
    }
  }
}
