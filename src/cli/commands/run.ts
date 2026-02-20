import process from 'node:process'
import {resolve} from 'node:path'
import type {Command} from 'commander'
import {DockerCliExecutor} from '../../engine/docker-executor.js'
import {PipelineLoader} from '../../core/pipeline-loader.js'
import {PipelineRunner} from '../../core/pipeline-runner.js'
import {ConsoleReporter} from '../../core/reporter.js'
import {InteractiveReporter} from '../interactive-reporter.js'
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
    .action(async (pipelineArg: string | undefined, options: {workspace?: string; force?: string | boolean; dryRun?: boolean; verbose?: boolean; target?: string; concurrency?: number; envFile?: string}, cmd: Command) => {
      const pipelineFile = await resolvePipelineFile(pipelineArg)
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)
      const loader = new PipelineLoader()
      const runtime = new DockerCliExecutor()

      const reporter = json ? new ConsoleReporter() : new InteractiveReporter({verbose: options.verbose})
      const runner = new PipelineRunner(loader, runtime, reporter, workdirRoot)

      const onSignal = (signal: NodeJS.Signals) => {
        void (async () => {
          await runtime.killRunningContainers()
          process.kill(process.pid, signal)
        })()
      }

      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)

      try {
        const force = options.force === true
          ? true
          : (typeof options.force === 'string' ? options.force.split(',') : undefined)
        const target = options.target ? options.target.split(',') : undefined
        await runner.run(pipelineFile, {workspace: options.workspace, force, dryRun: options.dryRun, target, concurrency: options.concurrency, envFile: options.envFile})
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
