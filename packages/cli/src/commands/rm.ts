import process from 'node:process'
import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Tylt} from '@tylt/core'
import {getGlobalOptions} from '../utils.js'

export function registerRmCommand(program: Command): void {
  program
    .command('rm')
    .description('Remove one or more workspaces')
    .argument('<workspace...>', 'Workspace names to remove')
    .action(async (workspaces: string[], _options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const tylt = new Tylt({workdir: workdirRoot})

      try {
        await tylt.removeWorkspace(...workspaces)
        for (const name of workspaces) {
          console.log(chalk.green(`Removed ${name}`))
        }
      } catch (error) {
        console.error(chalk.red((error as Error).message))
        process.exitCode = 1
      }
    })
}
