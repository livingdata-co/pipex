import process from 'node:process'
import {resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Tylt} from '@tylt/core'
import {getGlobalOptions} from '../utils.js'

export function registerCatCommand(program: Command): void {
  program
    .command('cat')
    .description('Read artifact content from a step\'s latest run')
    .argument('<workspace>', 'Workspace name')
    .argument('<step>', 'Step ID')
    .argument('[path]', 'Path within artifacts (omit to list)')
    .action(async (workspaceName: string, stepId: string, artifactPath: string | undefined, _options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const tylt = new Tylt({workdir: workdirRoot})
      const ws = await tylt.workspace(workspaceName)

      try {
        if (artifactPath) {
          const content = await ws.readArtifact(stepId, artifactPath)
          process.stdout.write(content)
        } else {
          const entries = await ws.listArtifacts(stepId)
          for (const entry of entries) {
            const suffix = entry.type === 'directory' ? '/' : ''
            console.log(entry.name + suffix)
          }
        }
      } catch {
        console.error(chalk.red(`Not found: ${artifactPath ?? '(artifacts directory)'}`))
        process.exitCode = 1
      }
    })
}
