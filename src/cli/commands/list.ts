import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '../../engine/workspace.js'
import {dirSize, formatSize, getGlobalOptions} from '../utils.js'

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List workspaces')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const names = await Workspace.list(workdirRoot)

      if (json) {
        console.log(JSON.stringify(names))
        return
      }

      if (names.length === 0) {
        console.log(chalk.gray('No workspaces found.'))
        return
      }

      const rows: Array<{name: string; runs: number; caches: number; size: string}> = []
      for (const name of names) {
        const ws = await Workspace.open(workdirRoot, name)
        const runs = await ws.listRuns()
        const caches = await ws.listCaches()
        const wsSize = await dirSize(ws.root)
        rows.push({name, runs: runs.length, caches: caches.length, size: formatSize(wsSize)})
      }

      const nameWidth = Math.max('WORKSPACE'.length, ...rows.map(r => r.name.length))
      const sizeWidth = Math.max('SIZE'.length, ...rows.map(r => r.size.length))
      const header = `${'WORKSPACE'.padEnd(nameWidth)}  RUNS  CACHES  ${'SIZE'.padStart(sizeWidth)}`
      console.log(chalk.bold(header))
      for (const row of rows) {
        console.log(`${row.name.padEnd(nameWidth)}  ${String(row.runs).padStart(4)}  ${String(row.caches).padStart(6)}  ${row.size.padStart(sizeWidth)}`)
      }
    })
}
