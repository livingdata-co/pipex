import process from 'node:process'
import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '@livingdata/pipex-core'
import {getGlobalOptions} from '../utils.js'

export function registerRmCommand(program: Command): void {
  program
    .command('rm')
    .description('Remove one or more workspaces')
    .argument('<workspace...>', 'Workspace names to remove')
    .action(async (workspaces: string[], _options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const existing = await Workspace.list(workdirRoot)

      for (const name of workspaces) {
        if (!existing.includes(name)) {
          console.error(chalk.red(`Workspace not found: ${name}`))
          process.exitCode = 1
          return
        }
      }

      for (const name of workspaces) {
        await Workspace.remove(workdirRoot, name)
        console.log(chalk.green(`Removed ${name}`))
      }
    })
}
