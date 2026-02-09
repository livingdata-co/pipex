import {access, mkdir, readdir, rename, rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'

/**
 * Isolated execution environment for container runs.
 *
 * A workspace provides:
 * - **staging/**: Temporary write location during execution
 * - **artifacts/**: Committed outputs (immutable, read-only)
 * - **caches/**: Persistent read-write caches (shared across steps)
 * - **state.json**: Managed by orchestration layer (e.g., CLI) for caching
 *
 * ## Artifact Lifecycle
 *
 * 1. `prepareArtifact()` creates `staging/{artifactId}/`
 * 2. Container writes to `staging/{artifactId}/` (mounted as `/output`)
 * 3. Success: `commitArtifact()` atomically moves to `artifacts/{artifactId}/`
 *    OR Failure: `discardArtifact()` deletes `staging/{artifactId}/`
 *
 * Artifacts are immutable once committed.
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
 * const artifactId = ws.generateArtifactId()
 * await ws.prepareArtifact(artifactId)
 * await ws.prepareCache('pnpm-store')
 * // ... container execution ...
 * await ws.commitArtifact(artifactId) // On success
 * // OR await ws.discardArtifact(artifactId) // On failure
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
   * Creates a new workspace with staging, artifacts, and caches directories.
   * @param workdirRoot - Root directory for all workspaces
   * @param id - Optional workspace ID (auto-generated if omitted)
   * @returns Newly created workspace
   */
  static async create(workdirRoot: string, id?: string): Promise<Workspace> {
    const workspaceId = id ?? Workspace.generateWorkspaceId()
    const root = join(workdirRoot, workspaceId)
    await mkdir(join(root, 'staging'), {recursive: true})
    await mkdir(join(root, 'artifacts'), {recursive: true})
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
      throw new Error(`Invalid workspace ID: ${id}`)
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
   * Generates a unique artifact identifier.
   * @returns Artifact ID in format: `{timestamp}-{uuid-prefix}`
   */
  generateArtifactId(): string {
    return Workspace.generateId()
  }

  /**
   * Returns the staging directory path for an artifact.
   * Staging is used for temporary writes during execution.
   * @param artifactId - Artifact identifier
   * @returns Absolute path to staging directory
   * @throws If artifact ID is invalid
   */
  stagingPath(artifactId: string): string {
    this.validateArtifactId(artifactId)
    return join(this.root, 'staging', artifactId)
  }

  /**
   * Returns the committed artifact directory path.
   * Artifacts are immutable once committed.
   * @param artifactId - Artifact identifier
   * @returns Absolute path to artifact directory
   * @throws If artifact ID is invalid
   */
  artifactPath(artifactId: string): string {
    this.validateArtifactId(artifactId)
    return join(this.root, 'artifacts', artifactId)
  }

  /**
   * Prepares a staging directory for a new artifact.
   * @param artifactId - Artifact identifier
   * @returns Absolute path to the created staging directory
   */
  async prepareArtifact(artifactId: string): Promise<string> {
    const path = this.stagingPath(artifactId)
    await mkdir(path, {recursive: true})
    return path
  }

  /**
   * Commits a staging artifact to the artifacts directory.
   * Uses atomic rename operation for consistency.
   * @param artifactId - Artifact identifier
   */
  async commitArtifact(artifactId: string): Promise<void> {
    await rename(this.stagingPath(artifactId), this.artifactPath(artifactId))
  }

  /**
   * Discards a staging artifact (on execution failure).
   * @param artifactId - Artifact identifier
   */
  async discardArtifact(artifactId: string): Promise<void> {
    await rm(this.stagingPath(artifactId), {recursive: true, force: true})
  }

  /**
   * Removes all staging directories.
   * Should be called on workspace initialization to clean up incomplete artifacts.
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
   * Lists all committed artifact IDs in this workspace.
   * @returns Array of artifact IDs (directory names in artifacts/)
   */
  async listArtifacts(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.root, 'artifacts'), {withFileTypes: true})
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      return []
    }
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
   * Validates an artifact ID to prevent path traversal attacks.
   * @param id - Artifact identifier to validate
   * @throws If the artifact ID contains invalid characters or path traversal attempts
   * @internal
   */
  private validateArtifactId(id: string): void {
    if (!/^[\w-]+$/.test(id)) {
      throw new Error(`Invalid artifact ID: ${id}. Must contain only alphanumeric characters, dashes, and underscores.`)
    }

    if (id.includes('..')) {
      throw new Error(`Invalid artifact ID: ${id}. Path traversal is not allowed.`)
    }
  }

  /**
   * Validates a cache name to prevent path traversal attacks.
   * Same rules as artifact IDs: alphanumeric, dashes, underscores only.
   * @param name - Cache name to validate
   * @throws If the cache name contains invalid characters or path traversal attempts
   * @internal
   */
  private validateCacheName(name: string): void {
    if (!/^[\w-]+$/.test(name)) {
      throw new Error(`Invalid cache name: ${name}. Must contain only alphanumeric characters, dashes, and underscores.`)
    }

    if (name.includes('..')) {
      throw new Error(`Invalid cache name: ${name}. Path traversal is not allowed.`)
    }
  }
}
