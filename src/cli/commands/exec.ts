import process from 'node:process'
import {randomUUID} from 'node:crypto'
import {dirname, resolve} from 'node:path'
import type {Command} from 'commander'
import {DockerCliExecutor} from '../../engine/docker-executor.js'
import {Workspace} from '../../engine/workspace.js'
import {loadStepFile} from '../../core/step-loader.js'
import {StepRunner} from '../../core/step-runner.js'
import {StateManager} from '../../core/state.js'
import {ConsoleReporter, type JobContext} from '../../core/reporter.js'
import {InteractiveReporter} from '../interactive-reporter.js'
import {getGlobalOptions} from '../utils.js'

export function registerExecCommand(program: Command): void {
  program
    .command('exec')
    .description('Execute a single step in a workspace')
    .argument('<workspace>', 'Workspace name')
    .requiredOption('-f, --file <path>', 'Step definition file (YAML or JSON)')
    .option('--step <id>', 'Step ID (overrides file\'s id)')
    .option('--input <specs...>', 'Input steps (e.g. "extract" or "data=extract")')
    .option('--ephemeral', 'Don\'t commit run, stream stdout to terminal')
    .option('--force', 'Skip cache check')
    .option('--verbose', 'Stream container logs in real-time')
    .action(async (
      workspaceName: string,
      options: {file: string; step?: string; input?: string[]; ephemeral?: boolean; force?: boolean; verbose?: boolean},
      cmd: Command
    ) => {
      const {workdir, json} = getGlobalOptions(cmd)
      const workdirRoot = resolve(workdir)

      const runtime = new DockerCliExecutor()
      const reporter = json ? new ConsoleReporter() : new InteractiveReporter({verbose: options.verbose})

      // Load step from file
      const stepFilePath = resolve(options.file)
      const step = await loadStepFile(stepFilePath, options.step)
      const pipelineRoot = dirname(stepFilePath)

      // Open or create workspace
      let workspace: Workspace
      try {
        workspace = await Workspace.open(workdirRoot, workspaceName)
      } catch {
        workspace = await Workspace.create(workdirRoot, workspaceName)
      }

      await workspace.cleanupStaging()
      await runtime.check()
      await runtime.cleanupContainers(workspace.id)

      const onSignal = (signal: NodeJS.Signals) => {
        void (async () => {
          await runtime.killRunningContainers()
          process.kill(process.pid, signal)
        })()
      }

      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)

      // Load state and resolve inputs
      const state = new StateManager(workspace.root)
      await state.load()

      const inputs = new Map<string, string>()
      if (options.input) {
        for (const spec of options.input) {
          const {alias, stepId} = parseInputSpec(spec)
          const stepState = state.getStep(stepId)
          if (!stepState) {
            console.error(`No run found for input step: ${stepId}`)
            process.exitCode = 1
            return
          }

          inputs.set(alias, stepState.runId)
        }
      }

      // Merge parsed inputs into step.inputs
      if (inputs.size > 0 && !step.inputs) {
        step.inputs = []
      }

      for (const [alias, _runId] of inputs) {
        // Only add if not already declared in step file
        if (!step.inputs!.some(i => i.step === alias)) {
          step.inputs!.push({step: alias})
        }
      }

      const job: JobContext = {workspaceId: workspace.id, jobId: randomUUID()}
      const runner = new StepRunner(runtime, reporter)
      await runner.run({
        workspace,
        state,
        step,
        inputs,
        pipelineRoot,
        force: options.force,
        ephemeral: options.ephemeral,
        job
      })
    })
}

function parseInputSpec(spec: string): {alias: string; stepId: string} {
  const eqIdx = spec.indexOf('=')
  if (eqIdx > 0) {
    return {alias: spec.slice(0, eqIdx), stepId: spec.slice(eqIdx + 1)}
  }

  return {alias: spec, stepId: spec}
}
