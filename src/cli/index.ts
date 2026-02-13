#!/usr/bin/env node
import 'dotenv/config'
import process from 'node:process'
import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import chalk from 'chalk'
import {Command} from 'commander'
import {Workspace} from '../engine/workspace.js'
import {DockerCliExecutor} from '../engine/docker-executor.js'
import {PipelineLoader} from './pipeline-loader.js'
import {PipelineRunner} from './pipeline-runner.js'
import {ConsoleReporter, InteractiveReporter} from './reporter.js'
import {StateManager} from './state.js'

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
    .argument('<pipeline>', 'Pipeline file to execute (JSON or YAML)')
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

  program
    .command('show')
    .description('Show steps and runs in a workspace')
    .argument('<workspace>', 'Workspace name')
    .action(async (workspaceName: string, _options: Record<string, unknown>, cmd: Command) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const workspace = await Workspace.open(workdirRoot, workspaceName)
      const state = new StateManager(workspace.root)
      await state.load()

      const steps = state.listSteps()

      if (steps.length === 0) {
        console.log(chalk.gray('No runs found in this workspace.'))
        return
      }

      const rows: Array<{stepId: string; stepName?: string; status: string; duration: string; date: string; runId: string}> = []

      for (const {stepId, runId} of steps) {
        const metaPath = join(workspace.runPath(runId), 'meta.json')
        try {
          const content = await readFile(metaPath, 'utf8')
          const meta = JSON.parse(content) as Record<string, unknown>
          rows.push({
            stepId,
            stepName: meta.stepName as string | undefined,
            status: meta.status as string,
            duration: `${meta.durationMs as number}ms`,
            date: (meta.finishedAt as string).replace('T', ' ').replace(/\.\d+Z$/, ''),
            runId
          })
        } catch {
          rows.push({stepId, status: 'unknown', duration: '-', date: '-', runId})
        }
      }

      if (json) {
        console.log(JSON.stringify(rows, null, 2))
        return
      }

      const stepWidth = Math.max('STEP'.length, ...rows.map(r => (r.stepName ? `${r.stepId} (${r.stepName})` : r.stepId).length))
      const statusWidth = Math.max('STATUS'.length, ...rows.map(r => r.status.length))
      const durationWidth = Math.max('DURATION'.length, ...rows.map(r => r.duration.length))
      const dateWidth = Math.max('FINISHED'.length, ...rows.map(r => r.date.length))

      console.log(chalk.bold(
        `${'STEP'.padEnd(stepWidth)}  ${'STATUS'.padEnd(statusWidth)}  ${'DURATION'.padStart(durationWidth)}  ${'FINISHED'.padEnd(dateWidth)}`
      ))
      for (const row of rows) {
        const stepLabel = row.stepName ? `${row.stepId} (${row.stepName})` : row.stepId
        const statusText = row.status === 'success' ? chalk.green(row.status) : chalk.red(row.status)
        console.log(
          `${stepLabel.padEnd(stepWidth)}  ${statusText.padEnd(statusWidth + (statusText.length - row.status.length))}  ${row.duration.padStart(durationWidth)}  ${row.date.padEnd(dateWidth)}`
        )
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

      const rows: Array<{name: string; runs: number; caches: number}> = []
      for (const name of names) {
        const ws = await Workspace.open(workdirRoot, name)
        const runs = await ws.listRuns()
        const caches = await ws.listCaches()
        rows.push({name, runs: runs.length, caches: caches.length})
      }

      const nameWidth = Math.max('WORKSPACE'.length, ...rows.map(r => r.name.length))
      const header = `${'WORKSPACE'.padEnd(nameWidth)}  RUNS  CACHES`
      console.log(chalk.bold(header))
      for (const row of rows) {
        console.log(`${row.name.padEnd(nameWidth)}  ${String(row.runs).padStart(4)}  ${String(row.caches).padStart(6)}`)
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
