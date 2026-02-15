import {readdir, stat} from 'node:fs/promises'
import {join} from 'node:path'

export async function dirSize(dirPath: string): Promise<number> {
  let total = 0
  try {
    const entries = await readdir(dirPath, {withFileTypes: true})
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await dirSize(fullPath)
      } else if (entry.isFile()) {
        const s = await stat(fullPath)
        total += s.size
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return total
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }

  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
