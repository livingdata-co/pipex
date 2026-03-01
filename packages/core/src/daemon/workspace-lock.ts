import process from 'node:process'
import {readFile, writeFile, rename, rm, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {WorkspaceLockedError, type LockInfo} from '../errors.js'

const lockFileName = 'daemon.json'

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Exclusive lock on a workspace directory.
 * Prevents concurrent pipeline executions on the same workspace.
 */
export class WorkspaceLock {
  /**
   * Acquires an exclusive lock on the workspace.
   * Throws WorkspaceLockedError if already locked by a live process.
   * Cleans stale locks from dead processes automatically.
   */
  static async acquire(workspaceRoot: string, socketPath?: string): Promise<WorkspaceLock> {
    const lockPath = join(workspaceRoot, lockFileName)

    // Check existing lock
    const existing = await WorkspaceLock.check(workspaceRoot)
    if (existing) {
      throw new WorkspaceLockedError(workspaceRoot, existing)
    }

    const info: LockInfo = {
      pid: process.pid,
      socketPath: socketPath ?? '',
      startedAt: new Date().toISOString(),
      version: 1
    }

    // Ensure workspace directory exists for the lock file
    // Only create the lock directory — workspace structure (staging/, runs/, caches/)
    // is the responsibility of Workspace.create()
    await mkdir(workspaceRoot, {recursive: true})
    const tmpPath = join(tmpdir(), `tylt-lock-${randomUUID()}.tmp`)
    await writeFile(tmpPath, JSON.stringify(info, null, 2), 'utf8')
    await rename(tmpPath, lockPath)

    return new WorkspaceLock(lockPath, info)
  }

  /**
   * Checks if a workspace is locked.
   * Returns LockInfo if locked by a live process, undefined otherwise.
   * Cleans up stale locks from dead processes.
   */
  static async check(workspaceRoot: string): Promise<LockInfo | undefined> {
    const lockPath = join(workspaceRoot, lockFileName)

    let content: string
    try {
      content = await readFile(lockPath, 'utf8')
    } catch {
      return undefined
    }

    let info: LockInfo
    try {
      info = JSON.parse(content) as LockInfo
    } catch {
      // Malformed lock file — remove it
      await rm(lockPath, {force: true})
      return undefined
    }

    if (!isPidAlive(info.pid)) {
      // Stale lock — process is dead, clean up
      await rm(lockPath, {force: true})
      return undefined
    }

    return info
  }

  private released = false

  private constructor(
    private readonly lockPath: string,
    readonly info: LockInfo
  ) {}

  /**
   * Releases the lock by removing the lock file.
   */
  async release(): Promise<void> {
    if (this.released) {
      return
    }

    this.released = true
    await rm(this.lockPath, {force: true})
  }
}
