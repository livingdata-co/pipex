import process from 'node:process'
import {cp} from 'node:fs/promises'
import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace, StateManager} from '@livingdata/pipex-core'
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

      const workspace = await Workspace.open(workdirRoot, workspaceName)
      const state = new StateManager(workspace.root)
      await state.load()

      const stepState = state.getStep(stepId)
      if (!stepState) {
        console.error(chalk.red(`No run found for step: ${stepId}`))
        process.exitCode = 1
        return
      }

      const artifactsPath = workspace.runArtifactsPath(stepState.runId)
      const destPath = resolve(dest)
      await cp(artifactsPath, destPath, {recursive: true})
      console.log(chalk.green(`Exported artifacts from ${stepId} to ${destPath}`))
    })
}
