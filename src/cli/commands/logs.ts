import process from 'node:process'
import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '../../engine/workspace.js'
import {StateManager} from '../../core/state.js'
import {getGlobalOptions} from '../utils.js'

export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description('Show logs from the last run of a step')
    .argument('<workspace>', 'Workspace name')
    .argument('<step>', 'Step ID')
    .option('-s, --stream <stream>', 'Show only stdout or stderr', 'both')
    .action(async (workspaceName: string, stepId: string, options: {stream: string}, cmd: Command) => {
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

      const runDir = workspace.runPath(stepState.runId)

      if (options.stream === 'both' || options.stream === 'stdout') {
        try {
          const stdout = await readFile(join(runDir, 'stdout.log'), 'utf8')
          if (stdout) {
            process.stdout.write(stdout)
          }
        } catch {
          // No stdout log
        }
      }

      if (options.stream === 'both' || options.stream === 'stderr') {
        try {
          const stderr = await readFile(join(runDir, 'stderr.log'), 'utf8')
          if (stderr) {
            if (options.stream === 'both') {
              console.error(chalk.red('── stderr ──'))
            }

            process.stderr.write(stderr)
          }
        } catch {
          // No stderr log
        }
      }
    })
}
