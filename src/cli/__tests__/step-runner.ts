import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import test from 'ava'
import {Workspace} from '../../engine/workspace.js'
import {DockerCliExecutor} from '../../engine/docker-executor.js'
import {ContainerCrashError} from '../../errors.js'
import {StateManager} from '../state.js'
import {StepRunner} from '../step-runner.js'
import type {Step} from '../../types.js'
import {createTmpDir, isDockerAvailable, noopReporter, recordingReporter} from '../../__tests__/helpers.js'

const hasDocker = isDockerAvailable()
const dockerTest = hasDocker ? test : test.skip

// -- helpers -----------------------------------------------------------------

function makeStep(overrides: Partial<Step> & {id: string}): Step {
  return {
    image: 'alpine:3.20',
    cmd: ['sh', '-c', 'echo hello'],
    ...overrides
  }
}

async function setupWorkspace(): Promise<{workspace: Workspace; state: StateManager; tmpDir: string}> {
  const tmpDir = await createTmpDir()
  const workspace = await Workspace.create(tmpDir, 'test-ws')
  const state = new StateManager(workspace.root)
  await state.load()
  return {workspace, state, tmpDir}
}

// -- minimal execution -------------------------------------------------------

dockerTest('minimal step writes artifact and returns exitCode 0', async t => {
  const {workspace, state} = await setupWorkspace()
  const runner = new StepRunner(new DockerCliExecutor(), noopReporter)
  const step = makeStep({id: 'greet', cmd: ['sh', '-c', 'echo hello > /output/greeting.txt']})

  const result = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})

  t.is(result.exitCode, 0)
  t.truthy(result.runId)

  // Artifact exists in committed run
  const content = await readFile(join(workspace.runArtifactsPath(result.runId!), 'greeting.txt'), 'utf8')
  t.is(content.trim(), 'hello')
})

dockerTest('meta.json exists with correct fields', async t => {
  const {workspace, state} = await setupWorkspace()
  const runner = new StepRunner(new DockerCliExecutor(), noopReporter)
  const step = makeStep({id: 'meta-test', cmd: ['sh', '-c', 'echo ok > /output/out.txt']})

  const result = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})

  const metaPath = join(workspace.runPath(result.runId!), 'meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf8'))
  t.is(meta.runId, result.runId)
  t.is(meta.exitCode, 0)
  t.is(meta.image, 'alpine:3.20')
  t.deepEqual(meta.cmd, ['sh', '-c', 'echo ok > /output/out.txt'])
})

// -- log capture -------------------------------------------------------------

dockerTest('stdout and stderr are captured to log files', async t => {
  const {workspace, state} = await setupWorkspace()
  const runner = new StepRunner(new DockerCliExecutor(), noopReporter)
  const step = makeStep({id: 'logs', cmd: ['sh', '-c', 'echo out-line && echo err-line >&2']})

  const result = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})

  const stdout = await readFile(join(workspace.runPath(result.runId!), 'stdout.log'), 'utf8')
  const stderr = await readFile(join(workspace.runPath(result.runId!), 'stderr.log'), 'utf8')
  t.true(stdout.includes('out-line'))
  t.true(stderr.includes('err-line'))
})

// -- cache hit ---------------------------------------------------------------

dockerTest('second run of same step is cached (STEP_SKIPPED)', async t => {
  const {workspace, state} = await setupWorkspace()
  const {reporter, events} = recordingReporter()
  const runner = new StepRunner(new DockerCliExecutor(), reporter)
  const step = makeStep({id: 'cached', cmd: ['sh', '-c', 'echo hi > /output/x.txt']})

  const first = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})
  const second = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})

  t.is(first.runId, second.runId)
  t.truthy(events.find(e => e.event === 'STEP_SKIPPED'))
})

// -- force -------------------------------------------------------------------

dockerTest('force: true produces new runId', async t => {
  const {workspace, state} = await setupWorkspace()
  const runner = new StepRunner(new DockerCliExecutor(), noopReporter)
  const step = makeStep({id: 'force-test', cmd: ['sh', '-c', 'echo data > /output/f.txt']})

  const first = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})
  const second = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/', force: true})

  t.not(first.runId, second.runId)
  t.is(second.exitCode, 0)
})

// -- ephemeral ---------------------------------------------------------------

dockerTest('ephemeral: true returns exitCode but no runId', async t => {
  const {workspace, state} = await setupWorkspace()
  const runner = new StepRunner(new DockerCliExecutor(), noopReporter)
  const step = makeStep({id: 'ephemeral', cmd: ['sh', '-c', 'echo temp > /output/t.txt']})

  const result = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/', ephemeral: true})

  t.is(result.exitCode, 0)
  t.is(result.runId, undefined)

  // No run committed
  const runs = await workspace.listRuns()
  t.is(runs.length, 0)
})

// -- failure -----------------------------------------------------------------

dockerTest('non-zero exit throws ContainerCrashError', async t => {
  const {workspace, state} = await setupWorkspace()
  const runner = new StepRunner(new DockerCliExecutor(), noopReporter)
  const step = makeStep({id: 'fail', cmd: ['sh', '-c', 'exit 1']})

  const error = await t.throwsAsync(
    async () => runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})
  )
  t.true(error instanceof ContainerCrashError)
})

// -- allowFailure ------------------------------------------------------------

dockerTest('allowFailure: true commits run with non-zero exitCode', async t => {
  const {workspace, state} = await setupWorkspace()
  const runner = new StepRunner(new DockerCliExecutor(), noopReporter)
  const step = makeStep({id: 'allow-fail', cmd: ['sh', '-c', 'exit 1'], allowFailure: true})

  const result = await runner.run({workspace, state, step, inputs: new Map(), pipelineRoot: '/'})

  t.truthy(result.runId)
  t.is(result.exitCode, 1)

  // Run was committed
  const runs = await workspace.listRuns()
  t.true(runs.includes(result.runId!))
})
