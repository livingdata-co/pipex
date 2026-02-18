import process from 'node:process'
import {readFile, readdir, stat} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import type {Command} from 'commander'
import {Workspace} from '../../engine/workspace.js'
import {StateManager} from '../../core/state.js'
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

      const workspace = await Workspace.open(workdirRoot, workspaceName)
      const state = new StateManager(workspace.root)
      await state.load()

      const stepState = state.getStep(stepId)
      if (!stepState) {
        console.error(chalk.red(`No run found for step: ${stepId}`))
        process.exitCode = 1
        return
      }

      const artifactsDir = workspace.runArtifactsPath(stepState.runId)
      const targetPath = artifactPath ? join(artifactsDir, artifactPath) : artifactsDir

      // Prevent path traversal
      if (!targetPath.startsWith(artifactsDir)) {
        console.error(chalk.red('Invalid path: must be within artifacts directory'))
        process.exitCode = 1
        return
      }

      try {
        const info = await stat(targetPath)

        if (info.isDirectory()) {
          const entries = await readdir(targetPath, {withFileTypes: true})
          for (const entry of entries) {
            const suffix = entry.isDirectory() ? '/' : ''
            console.log(entry.name + suffix)
          }
        } else {
          const content = await readFile(targetPath)
          process.stdout.write(content)
        }
      } catch {
        console.error(chalk.red(`Not found: ${artifactPath ?? '(artifacts directory)'}`))
        process.exitCode = 1
      }
    })
}
