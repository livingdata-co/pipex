import process from 'node:process'
import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '../../engine/workspace.js'
import {StateManager} from '../../core/state.js'
import {dirSize, formatDuration, formatSize} from '../../core/utils.js'
import {getGlobalOptions} from '../utils.js'

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
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

      // Build a map of actively running steps (with live PID)
      const activeRunning = new Map<string, typeof runningSteps[number]>()
      for (const running of runningSteps) {
        if (isProcessAlive(running.pid)) {
          activeRunning.set(running.stepId, running)
        }
      }

      const rows: Array<{stepId: string; stepName?: string; status: string; duration: string; size: string; date: string; runId: string}> = []

      let totalSize = 0
      for (const {stepId, runId} of steps) {
        // Running marker overrides committed state (step is being re-executed)
        if (activeRunning.has(stepId)) {
          const running = activeRunning.get(stepId)!
          activeRunning.delete(stepId)
          const elapsedMs = Date.now() - new Date(running.startedAt).getTime()
          rows.push({
            stepId,
            stepName: running.stepName,
            status: 'running',
            duration: formatDuration(elapsedMs),
            size: '-',
            date: '-',
            runId: '-'
          })
          continue
        }

        const metaPath = join(workspace.runPath(runId), 'meta.json')
        try {
          const content = await readFile(metaPath, 'utf8')
          const meta = JSON.parse(content) as Record<string, unknown>
          const artifactBytes = await dirSize(workspace.runArtifactsPath(runId))
          totalSize += artifactBytes
          rows.push({
            stepId,
            stepName: meta.stepName as string | undefined,
            status: meta.status as string,
            duration: `${meta.durationMs as number}ms`,
            size: formatSize(artifactBytes),
            date: (meta.finishedAt as string).replace('T', ' ').replace(/\.\d+Z$/, ''),
            runId
          })
        } catch {
          rows.push({stepId, status: 'unknown', duration: '-', size: '-', date: '-', runId})
        }
      }

      // Add remaining running steps (not in committed state at all)
      for (const [, running] of activeRunning) {
        const elapsedMs = Date.now() - new Date(running.startedAt).getTime()
        rows.push({
          stepId: running.stepId,
          stepName: running.stepName,
          status: 'running',
          duration: formatDuration(elapsedMs),
          size: '-',
          date: '-',
          runId: '-'
        })
      }

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
