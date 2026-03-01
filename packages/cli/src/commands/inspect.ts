import process from 'node:process'
import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Tylt} from '@tylt/core'
import {getGlobalOptions} from '../utils.js'

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Show metadata from the last run of a step')
    .argument('<workspace>', 'Workspace name')
    .argument('<step>', 'Step ID')
    .action(async (workspaceName: string, stepId: string, _options: Record<string, unknown>, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const tylt = new Tylt({workdir: workdirRoot})
      const ws = await tylt.workspace(workspaceName)

      try {
        const meta = await ws.inspect(stepId)

        if (json) {
          console.log(JSON.stringify(meta, null, 2))
        } else {
          console.log(chalk.bold(`\nRun: ${chalk.cyan(meta.runId as string)}`))
          console.log(`  Step:       ${meta.stepId as string}${meta.stepName ? ` (${meta.stepName as string})` : ''}`)
          console.log(`  Status:     ${meta.status === 'success' ? chalk.green('success') : chalk.red('failure')}`)
          console.log(`  Image:      ${meta.image as string}`)
          console.log(`  Command:    ${(meta.cmd as string[]).join(' ')}`)
          console.log(`  Duration:   ${meta.durationMs as number}ms`)
          console.log(`  Started:    ${meta.startedAt as string}`)
          console.log(`  Finished:   ${meta.finishedAt as string}`)
          console.log(`  Exit code:  ${meta.exitCode as number}`)
          console.log(`  Fingerprint: ${meta.fingerprint as string}`)
          if (meta.env && Object.keys(meta.env as Record<string, string>).length > 0) {
            console.log(`  Env:        ${JSON.stringify(meta.env)}`)
          }

          if (meta.inputs && (meta.inputs as unknown[]).length > 0) {
            console.log(`  Inputs:     ${JSON.stringify(meta.inputs)}`)
          }

          console.log()
        }
      } catch {
        console.error(chalk.red(`No metadata found for step: ${stepId}`))
        process.exitCode = 1
      }
    })
}
