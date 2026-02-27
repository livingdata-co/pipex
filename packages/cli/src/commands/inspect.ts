import process from 'node:process'
import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace, StateManager} from '@livingdata/pipex-core'
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

      const workspace = await Workspace.open(workdirRoot, workspaceName)
      const state = new StateManager(workspace.root)
      await state.load()

      const stepState = state.getStep(stepId)
      if (!stepState) {
        console.error(chalk.red(`No run found for step: ${stepId}`))
        process.exitCode = 1
        return
      }

      const metaPath = join(workspace.runPath(stepState.runId), 'meta.json')
      try {
        const content = await readFile(metaPath, 'utf8')
        if (json) {
          console.log(content)
        } else {
          const meta = JSON.parse(content) as Record<string, unknown>
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
        console.error(chalk.red(`No metadata found for run: ${stepState.runId}`))
        process.exitCode = 1
      }
    })
}
