import {execSync} from 'node:child_process'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Reporter, PipelineEvent} from '../reporter.js'

/**
 * Creates a temporary directory for test isolation.
 * Each test should use its own tmpdir to avoid interference.
 */
export async function createTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tylt-test-'))
}

/**
 * Silent reporter — all methods are no-ops.
 */
export const noopReporter: Reporter = {
  emit() {/* noop */}
}

/**
 * Returns a reporter that records emit() calls for assertions.
 */
export function recordingReporter(): {reporter: Reporter; events: PipelineEvent[]} {
  const events: PipelineEvent[] = []
  const reporter: Reporter = {
    emit(event: PipelineEvent) {
      events.push(event)
    }
  }

  return {reporter, events}
}

/**
 * Checks if Docker is available on the host (synchronous for use at module level).
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker version', {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}
