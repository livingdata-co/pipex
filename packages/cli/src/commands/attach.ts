import process from 'node:process'
import {resolve} from 'node:path'
import type {Command} from 'commander'
import {Tylt, ConsoleReporter} from '@tylt/core'
import {InteractiveReporter} from '../interactive-reporter.js'
import {getGlobalOptions} from '../utils.js'

export function registerAttachCommand(program: Command): void {
  program
    .command('attach')
    .description('Attach to a running pipeline in a workspace')
    .argument('<workspace>', 'Workspace name')
    .option('--verbose', 'Stream container logs in real-time')
    .action(async (workspaceName: string, options: {verbose?: boolean}, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const tylt = new Tylt({workdir: workdirRoot})
      const client = await tylt.attach(workspaceName)

      const reporter = json
        ? new ConsoleReporter()
        : new InteractiveReporter({verbose: options.verbose})

      client.on('event', event => {
        reporter.emit(event)
      })

      client.on('done', success => {
        if (json) {
          console.log(JSON.stringify({done: true, success}))
        } else {
          console.log(success ? 'Pipeline completed' : 'Pipeline failed')
        }

        void client.disconnect()
        // eslint-disable-next-line unicorn/no-process-exit
        process.exit(success ? 0 : 1)
      })

      client.on('error', error => {
        console.error('Daemon error:', error.message)
      })

      client.on('close', () => {
        console.log('Disconnected from daemon')
      })

      // Ctrl+C disconnects but doesn't stop the daemon
      const onSignal = () => {
        void client.disconnect()
      }

      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)
    })
}
