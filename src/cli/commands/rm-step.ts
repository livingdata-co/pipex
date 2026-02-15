import process from 'node:process'
import {rm} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '../../engine/workspace.js'
import {StateManager} from '../../core/state.js'
import {dirSize, formatSize} from '../../core/utils.js'
import {getGlobalOptions} from '../utils.js'

export function registerRmStepCommand(program: Command): void {
  program
    .command('rm-step')
    .description('Remove a step\'s run and state entry')
    .argument('<workspace>', 'Workspace name')
    .argument('<step>', 'Step ID')
    .action(async (workspaceName: string, stepId: string, cmd: Command) => {
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

      const {runId} = stepState

      // Measure size before removal
      const runDir = workspace.runPath(runId)
      const size = await dirSize(runDir)

      // Remove run directory
      await rm(runDir, {recursive: true, force: true})

      // Remove step-runs symlink
      const linkPath = join(workspace.root, 'step-runs', stepId)
      await rm(linkPath, {force: true})

      // Remove from state
      state.removeStep(stepId)
      await state.save()

      console.log(chalk.green(`Removed step ${chalk.bold(stepId)} (run ${runId}, freed ${formatSize(size)})`))
    })
}
