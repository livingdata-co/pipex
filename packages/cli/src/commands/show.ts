import process from 'node:process'
import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace, StateManager, dirSize, formatDuration, formatSize} from '@livingdata/pipex-core'
import {getGlobalOptions} from '../utils.js'

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export type StepMeta = {
  stepName?: string;
  status: string;
  durationMs: number;
  finishedAt: string;
  artifactBytes: number;
}

export type ResolvedShowStep = {
  stepId: string;
  stepName?: string;
  status: 'running' | 'success' | 'failure' | 'unknown';
  durationMs?: number;
  artifactBytes: number;
  finishedAt?: string;
  runId?: string;
  startedAt?: string;
}

/**
 * Resolves the display state of all steps by merging committed state with running markers.
 * Loads meta from disk via the injected `loadMeta` callback.
 * Running steps with a live PID override their committed state.
 * Running steps not yet in committed state are appended.
 */
export async function resolveShowSteps(
  committed: Array<{stepId: string; runId: string}>,
  running: Array<{stepId: string; startedAt: string; pid: number; stepName?: string}>,
  loadMeta: (runId: string) => Promise<StepMeta | undefined>,
  isAlive: (pid: number) => boolean
): Promise<ResolvedShowStep[]> {
  const activeRunning = new Map<string, typeof running[number]>()
  for (const r of running) {
    if (isAlive(r.pid)) {
      activeRunning.set(r.stepId, r)
    }
  }

  const rows: ResolvedShowStep[] = []

  for (const step of committed) {
    if (activeRunning.has(step.stepId)) {
      const r = activeRunning.get(step.stepId)!
      activeRunning.delete(step.stepId)
      rows.push({
        stepId: step.stepId,
        stepName: r.stepName,
        status: 'running',
        artifactBytes: 0,
        startedAt: r.startedAt
      })
      continue
    }

    const meta = await loadMeta(step.runId)
    if (meta) {
      rows.push({
        stepId: step.stepId,
        stepName: meta.stepName,
        status: meta.status as 'success' | 'failure',
        durationMs: meta.durationMs,
        artifactBytes: meta.artifactBytes,
        finishedAt: meta.finishedAt,
        runId: step.runId
      })
    } else {
      rows.push({
        stepId: step.stepId,
        status: 'unknown',
        artifactBytes: 0,
        runId: step.runId
      })
    }
  }

  // Append running steps not in committed state
  for (const [, r] of activeRunning) {
    rows.push({
      stepId: r.stepId,
      stepName: r.stepName,
      status: 'running',
      artifactBytes: 0,
      startedAt: r.startedAt
    })
  }

  return rows
}

export function registerShowCommand(program: Command): void {
  program
    .command('show')
    .description('Show steps and runs in a workspace')
    .argument('<workspace>', 'Workspace name')
    .action(async (workspaceName: string, _options: Record<string, unknown>, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const workspace = await Workspace.open(workdirRoot, workspaceName)
      const state = new StateManager(workspace.root)
      await state.load()

      const steps = state.listSteps()
      const runningSteps = await workspace.listRunningSteps()

      async function loadMeta(runId: string): Promise<StepMeta | undefined> {
        const metaPath = join(workspace.runPath(runId), 'meta.json')
        try {
          const content = await readFile(metaPath, 'utf8')
          const meta = JSON.parse(content) as Record<string, unknown>
          const artifactBytes = await dirSize(workspace.runArtifactsPath(runId))
          return {
            stepName: meta.stepName as string | undefined,
            status: meta.status as string,
            durationMs: meta.durationMs as number,
            finishedAt: meta.finishedAt as string,
            artifactBytes
          }
        } catch {
          return undefined
        }
      }

      const resolved = await resolveShowSteps(steps, runningSteps, loadMeta, isProcessAlive)

      const rows = resolved.map(r => ({
        stepId: r.stepId,
        stepName: r.stepName,
        status: r.status,
        duration: r.durationMs === undefined
          ? (r.startedAt
            ? formatDuration(Date.now() - new Date(r.startedAt).getTime())
            : '-')
          : formatDuration(r.durationMs),
        size: r.artifactBytes > 0 ? formatSize(r.artifactBytes) : '-',
        date: r.finishedAt
          ? r.finishedAt.replace('T', ' ').replace(/\.\d+Z$/, '')
          : '-',
        runId: r.runId ?? '-'
      }))

      const totalSize = resolved.reduce((sum, r) => sum + r.artifactBytes, 0)

      if (rows.length === 0) {
        console.log(chalk.gray('No runs found in this workspace.'))
        return
      }

      if (json) {
        console.log(JSON.stringify(rows, null, 2))
        return
      }

      const stepWidth = Math.max('STEP'.length, ...rows.map(r => (r.stepName ? `${r.stepId} (${r.stepName})` : r.stepId).length))
      const statusWidth = Math.max('STATUS'.length, ...rows.map(r => r.status.length))
      const durationWidth = Math.max('DURATION'.length, ...rows.map(r => r.duration.length))
      const sizeWidth = Math.max('SIZE'.length, ...rows.map(r => r.size.length))
      const dateWidth = Math.max('FINISHED'.length, ...rows.map(r => r.date.length))

      console.log(chalk.bold(
        `${'STEP'.padEnd(stepWidth)}  ${'STATUS'.padEnd(statusWidth)}  ${'DURATION'.padStart(durationWidth)}  ${'SIZE'.padStart(sizeWidth)}  ${'FINISHED'.padEnd(dateWidth)}`
      ))
      for (const row of rows) {
        const stepLabel = row.stepName ? `${row.stepId} (${row.stepName})` : row.stepId
        const statusColor = row.status === 'success'
          ? chalk.green
          : (row.status === 'running' ? chalk.yellow : chalk.red)
        const statusText = statusColor(row.status)
        const statusPad = statusWidth + (statusText.length - row.status.length)
        const cols = [
          stepLabel.padEnd(stepWidth),
          statusText.padEnd(statusPad),
          row.duration.padStart(durationWidth),
          row.size.padStart(sizeWidth),
          row.date.padEnd(dateWidth)
        ]
        console.log(cols.join('  '))
      }

      if (rows.length > 1) {
        console.log(chalk.gray(`\n  Total: ${formatSize(totalSize)}`))
      }
    })
}
