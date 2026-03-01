import process from 'node:process'
import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Tylt, formatSize} from '@tylt/core'
import {getGlobalOptions} from '../utils.js'

export function registerRmStepCommand(program: Command): void {
  program
    .command('rm-step')
    .description('Remove a step\'s run and state entry')
    .argument('<workspace>', 'Workspace name')
    .argument('<step>', 'Step ID')
    .action(async (workspaceName: string, stepId: string, _options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const tylt = new Tylt({workdir: workdirRoot})
      const ws = await tylt.workspace(workspaceName)

      // Get step info before removal for display
      const steps = await ws.show()
      const stepInfo = steps.find(s => s.stepId === stepId)

      try {
        await ws.removeStep(stepId)
        const sizeInfo = stepInfo?.artifactSize ? `, freed ${formatSize(stepInfo.artifactSize)}` : ''
        const runInfo = stepInfo?.runId ? ` (run ${stepInfo.runId}${sizeInfo})` : ''
        console.log(chalk.green(`Removed step ${chalk.bold(stepId)}${runInfo}`))
      } catch {
        console.error(chalk.red(`No run found for step: ${stepId}`))
        process.exitCode = 1
      }
    })
}
