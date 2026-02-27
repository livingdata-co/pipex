import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Pipex} from '@livingdata/pipex-core'
import {getGlobalOptions} from '../utils.js'

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Extract artifacts from a step run to the host filesystem')
    .argument('<workspace>', 'Workspace name')
    .argument('<step>', 'Step ID')
    .argument('<dest>', 'Destination directory')
    .action(async (workspaceName: string, stepId: string, dest: string, _options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const pipex = new Pipex({workdir: workdirRoot})
      const ws = await pipex.workspace(workspaceName)

      const destPath = resolve(dest)
      await ws.exportArtifacts(stepId, destPath)
      console.log(chalk.green(`Exported artifacts from ${stepId} to ${destPath}`))
    })
}
