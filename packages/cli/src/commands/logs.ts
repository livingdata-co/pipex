import process from 'node:process'
import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Tylt} from '@tylt/core'
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

      const tylt = new Tylt({workdir: workdirRoot})
      const ws = await tylt.workspace(workspaceName)

      if (options.stream === 'both' || options.stream === 'stdout') {
        const stdout = await ws.logs(stepId, 'stdout')
        if (stdout) {
          process.stdout.write(stdout)
        }
      }

      if (options.stream === 'both' || options.stream === 'stderr') {
        const stderr = await ws.logs(stepId, 'stderr')
        if (stderr) {
          if (options.stream === 'both') {
            console.error(chalk.red('── stderr ──'))
          }

          process.stderr.write(stderr)
        }
      }
    })
}
