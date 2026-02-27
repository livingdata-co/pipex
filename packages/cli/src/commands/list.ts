import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Pipex, formatSize} from '@livingdata/pipex-core'
import {getGlobalOptions} from '../utils.js'

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List workspaces')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const pipex = new Pipex({workdir: workdirRoot})
      const workspaces = await pipex.workspaces()

      if (json) {
        console.log(JSON.stringify(workspaces.map(w => w.name)))
        return
      }

      if (workspaces.length === 0) {
        console.log(chalk.gray('No workspaces found.'))
        return
      }

      const rows = workspaces.map(w => ({
        ...w,
        sizeFormatted: formatSize(w.size)
      }))

      const nameWidth = Math.max('WORKSPACE'.length, ...rows.map(r => r.name.length))
      const sizeWidth = Math.max('SIZE'.length, ...rows.map(r => r.sizeFormatted.length))
      const header = `${'WORKSPACE'.padEnd(nameWidth)}  RUNS  CACHES  ${'SIZE'.padStart(sizeWidth)}`
      console.log(chalk.bold(header))
      for (const row of rows) {
        console.log(`${row.name.padEnd(nameWidth)}  ${String(row.runs).padStart(4)}  ${String(row.caches).padStart(6)}  ${row.sizeFormatted.padStart(sizeWidth)}`)
      }
    })
}
