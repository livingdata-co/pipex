#!/usr/bin/env node
import 'dotenv/config'
import process from 'node:process'
import {resolve} from 'node:path'
import chalk from 'chalk'
import {Command} from 'commander'
import {Workspace} from '../engine/workspace.js'
import {DockerCliExecutor} from '../engine/docker-executor.js'
import {PipelineLoader} from './pipeline-loader.js'
import {PipelineRunner} from './pipeline-runner.js'
import {ConsoleReporter, InteractiveReporter} from './reporter.js'

type GlobalOptions = {
  workdir: string;
  json?: boolean;
}

function getGlobalOptions(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>()
}

async function main() {
  const program = new Command()

  program
    .name('pipex')
    .description('Execution engine for containerized steps')
    .version('0.1.0')
    .option('--workdir <path>', 'Workspaces root directory', process.env.PIPEX_WORKDIR ?? './workdir')
    .option('--json', 'Output structured JSON logs')

  program
    .command('run')
    .description('Execute a pipeline')
    .argument('<pipeline>', 'Pipeline JSON file to execute')
    .option('-w, --workspace <name>', 'Workspace name (for caching)')
    .option('-f, --force [steps]', 'Skip cache for all steps, or a comma-separated list (e.g. --force step1,step2)')
    .action(async (pipelineFile: string, options: {workspace?: string; force?: string | boolean}, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const loader = new PipelineLoader()
      const runtime = new DockerCliExecutor()

      const reporter = json ? new ConsoleReporter() : new InteractiveReporter()
      const runner = new PipelineRunner(loader, runtime, reporter, workdirRoot)

      try {
        const force = options.force === true
          ? true
          : (typeof options.force === 'string' ? options.force.split(',') : undefined)
        await runner.run(pipelineFile, {workspace: options.workspace, force})
        if (json) {
          console.log('Pipeline completed')
        }
      } catch (error: unknown) {
        if (json) {
          console.error('Pipeline failed:', error instanceof Error ? error.message : error)
        }

        throw error
      }
    })

  program
    .command('list')
    .alias('ls')
    .description('List workspaces')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const names = await Workspace.list(workdirRoot)

      if (json) {
        console.log(JSON.stringify(names))
        return
      }

      if (names.length === 0) {
        console.log(chalk.gray('No workspaces found.'))
        return
      }

      const rows: Array<{name: string; artifacts: number; caches: number}> = []
      for (const name of names) {
        const ws = await Workspace.open(workdirRoot, name)
        const artifacts = await ws.listArtifacts()
        const caches = await ws.listCaches()
        rows.push({name, artifacts: artifacts.length, caches: caches.length})
      }

      const nameWidth = Math.max('WORKSPACE'.length, ...rows.map(r => r.name.length))
      const header = `${'WORKSPACE'.padEnd(nameWidth)}  ARTIFACTS  CACHES`
      console.log(chalk.bold(header))
      for (const row of rows) {
        console.log(`${row.name.padEnd(nameWidth)}  ${String(row.artifacts).padStart(9)}  ${String(row.caches).padStart(6)}`)
      }
    })

  program
    .command('rm')
    .description('Remove one or more workspaces')
    .argument('<workspace...>', 'Workspace names to remove')
    .action(async (workspaces: string[], _options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const existing = await Workspace.list(workdirRoot)

      for (const name of workspaces) {
        if (!existing.includes(name)) {
          console.error(chalk.red(`Workspace not found: ${name}`))
          process.exitCode = 1
          return
        }
      }

      for (const name of workspaces) {
        await Workspace.remove(workdirRoot, name)
        console.log(chalk.green(`Removed ${name}`))
      }
    })

  program
    .command('clean')
    .description('Remove all workspaces')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const {workdir} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const names = await Workspace.list(workdirRoot)

      if (names.length === 0) {
        console.log(chalk.gray('No workspaces to clean.'))
        return
      }

      for (const name of names) {
        await Workspace.remove(workdirRoot, name)
      }

      console.log(chalk.green(`Removed ${names.length} workspace${names.length > 1 ? 's' : ''}.`))
    })

  await program.parseAsync()
}

try {
  await main()
} catch (error: unknown) {
  console.error('Fatal error:', error)
  throw error
}
