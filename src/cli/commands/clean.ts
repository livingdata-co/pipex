import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '../../engine/workspace.js'
import {getGlobalOptions} from '../utils.js'

export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Remove all workspaces')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const names = await Workspace.list(workdirRoot)

      if (names.length === 0) {
        console.log(chalk.gray('No workspaces to clean.'))
        return
      }

      for (const name of names) {
        await Workspace.remove(workdirRoot, name)
      }

      console.log(chalk.green(`Removed ${names.length} workspace${names.length > 1 ? 's' : ''}.`))
    })
}
