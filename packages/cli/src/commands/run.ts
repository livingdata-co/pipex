import process from 'node:process'
import {resolve} from 'node:path'
import type {Command} from 'commander'
import {DockerCliExecutor, Pipex, ConsoleReporter} from '@livingdata/pipex-core'
import {InteractiveReporter} from '../interactive-reporter.js'
import {loadConfig} from '../config.js'
import {getGlobalOptions, resolvePipelineFile} from '../utils.js'

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Execute a pipeline')
    .argument('[pipeline]', 'Pipeline file or directory (default: current directory)')
    .option('-w, --workspace <name>', 'Workspace name (for caching)')
    .option('-f, --force [steps]', 'Skip cache for all steps, or a comma-separated list (e.g. --force step1,step2)')
    .option('--dry-run', 'Validate pipeline and show what would run without executing')
    .option('--verbose', 'Stream container logs in real-time (interactive mode)')
    .option('-t, --target <steps>', 'Execute only these steps and their dependencies (comma-separated)')
    .option('-c, --concurrency <number>', 'Max parallel step executions (default: CPU count)', Number)
    .option('--env-file <path>', 'Load environment variables from a dotenv file for all steps')
    .option('-d, --detach', 'Run pipeline in background (daemon mode)')
    .option('--attach', 'Force in-process execution (override detach config)')
    .action(async (pipelineArg: string | undefined, options: {
      workspace?: string; force?: string | boolean; dryRun?: boolean; verbose?: boolean;
      target?: string; concurrency?: number; envFile?: string; detach?: boolean; attach?: boolean;
    }, cmd: Command) => {
      const pipelineFile = await resolvePipelineFile(pipelineArg)
      const {workdir, json} = getGlobalOptions(cmd)
      const cwd = process.cwd()
      const config = await loadConfig(cwd)
      const runtime = new DockerCliExecutor()
      const reporter = json ? new ConsoleReporter() : new InteractiveReporter({verbose: options.verbose})
      const workdirRoot = resolve(workdir)

      const pipex = new Pipex({runtime, reporter, workdir: workdirRoot, config, cwd})

      // Load the pipeline once — needed for both detached and attached modes
      const pipeline = await pipex.load(pipelineFile)

      // Determine execution mode: --attach wins, then --detach, then config
      const detach = options.attach ? false : (options.detach ?? config.detach ?? false)

      const force = options.force === true
        ? true
        : (typeof options.force === 'string' ? options.force.split(',') : undefined)
      const target = options.target ? options.target.split(',') : undefined
      if (detach) {
        const handle = await pipex.runDetached(pipeline, {
          workspace: options.workspace,
          force,
          target,
          concurrency: options.concurrency,
          envFile: options.envFile
        })

        if (json) {
          console.log(JSON.stringify(handle))
        } else {
          console.log(`Pipeline started in background (workspace: ${handle.workspaceId}, pid: ${handle.pid})`)
        }

        return
      }

      // Attached mode: in-process execution

      const onSignal = (signal: NodeJS.Signals) => {
        void (async () => {
          await runtime.killRunningContainers()
          process.kill(process.pid, signal)
        })()
      }

      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)

      try {
        await pipex.run(pipeline, {workspace: options.workspace, force, dryRun: options.dryRun, target, concurrency: options.concurrency, envFile: options.envFile})
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
}
