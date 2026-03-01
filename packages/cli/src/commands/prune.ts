import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Tylt} from '@tylt/core'
import {getGlobalOptions} from '../utils.js'

export function registerPruneCommand(program: Command): void {
  program
    .command('prune')
    .description('Remove old runs not referenced by current state')
    .argument('<workspace>', 'Workspace name')
    .action(async (workspaceName: string, _options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const tylt = new Tylt({workdir: workdirRoot})
      const ws = await tylt.workspace(workspaceName)
      const {removed} = await ws.prune()

      if (removed === 0) {
        console.log(chalk.gray('No old runs to remove.'))
      } else {
        console.log(chalk.green(`Removed ${removed} old run${removed > 1 ? 's' : ''}.`))
      }
    })
}
