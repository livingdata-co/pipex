import {execSync} from 'node:child_process'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Reporter, StepRef, PipelineEvent} from '../cli/reporter.js'

/**
 * Creates a temporary directory for test isolation.
 * Each test should use its own tmpdir to avoid interference.
 */
export async function createTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pipex-test-'))
}

/**
 * Silent reporter — all methods are no-ops.
 */
export const noopReporter: Reporter = {
  state() {/* noop */},
  log() {/* noop */},
  result() {/* noop */}
}

export type RecordedEvent = {
  event: PipelineEvent;
  workspaceId: string;
  step?: StepRef;
  meta?: Record<string, unknown>;
}

/**
 * Returns a reporter that records state() calls for assertions.
 */
export function recordingReporter(): {reporter: Reporter; events: RecordedEvent[]} {
  const events: RecordedEvent[] = []
  const reporter: Reporter = {
    state(workspaceId: string, event: PipelineEvent, step?: StepRef, meta?: Record<string, unknown>) {
      events.push({event, workspaceId, step, meta})
    },
    log() {/* noop */},
    result() {/* noop */}
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
