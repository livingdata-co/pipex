import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '../../engine/workspace.js'
import {StateManager} from '../state.js'
import {dirSize, formatSize, getGlobalOptions} from '../utils.js'

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

      if (steps.length === 0) {
        console.log(chalk.gray('No runs found in this workspace.'))
        return
      }

      const rows: Array<{stepId: string; stepName?: string; status: string; duration: string; size: string; date: string; runId: string}> = []

      let totalSize = 0
      for (const {stepId, runId} of steps) {
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
        const statusText = row.status === 'success' ? chalk.green(row.status) : chalk.red(row.status)
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
