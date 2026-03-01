import {join} from 'node:path'
import {readFile} from 'node:fs/promises'
import test from 'ava'
import {Workspace} from '../engine/workspace.js'
import {DockerCliExecutor} from '../engine/docker-executor.js'
import {DaemonServer} from '../daemon/daemon-server.js'
import {DaemonClient} from '../daemon/daemon-client.js'
import type {PipelineEvent, StepFinishedEvent} from '../reporter.js'
import type {StepState} from '../event-aggregator.js'
import {createTmpDir, isDockerAvailable} from './helpers.js'

const hasDocker = isDockerAvailable()
const dockerTest = hasDocker ? test : test.skip

async function startDaemon(workdir: string, workspaceId: string) {
  const wsRoot = join(workdir, workspaceId)
  await Workspace.create(workdir, workspaceId)

  const server = new DaemonServer({
    workspaceRoot: wsRoot,
    tyltOptions: {workdir, runtime: new DockerCliExecutor()}
  })

  await server.start()
  return server
}

function collectEvents(client: DaemonClient) {
  const events: PipelineEvent[] = []
  client.on('event', event => {
    events.push(event)
  })
  return events
}

// -- Real pipeline execution through daemon ----------------------------------

dockerTest('run pipeline through daemon, receive events, verify artifacts', async t => {
  const workdir = await createTmpDir()
  const server = await startDaemon(workdir, 'integ-test')
  t.teardown(async () => server.stop())

  const client = await DaemonClient.connect(server.socketPath)
  t.teardown(async () => client.disconnect())

  const events = collectEvents(client)

  // Send a 2-step pipeline: step A writes a file, step B reads it
  const jobId = await client.run({
    id: 'integ-test',
    root: workdir,
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo hello > /output/result.txt']},
      {id: 'b', image: 'alpine:3.20', cmd: ['sh', '-c', 'cat /input/a/result.txt > /output/copy.txt'], inputs: [{step: 'a'}]}
    ]
  }, {workspace: 'integ-test'})

  t.truthy(jobId)

  // Wait for done
  const success = await new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for pipeline completion'))
    }, 30_000)
    client.on('done', result => {
      clearTimeout(timer)
      resolve(result)
    })
    client.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
  })

  t.true(success)

  // Verify we received the expected event types
  const eventTypes = new Set(events.map(e => e.event))
  t.true(eventTypes.has('PIPELINE_START'))
  t.true(eventTypes.has('PIPELINE_FINISHED'))

  const finished = events.filter((e): e is StepFinishedEvent => e.event === 'STEP_FINISHED')
  t.is(finished.length, 2)

  // Verify artifacts were committed to disk
  const ws = await Workspace.open(workdir, 'integ-test')
  const bRunId = finished.find(e => e.step.id === 'b')!.runId!
  const content = await readFile(join(ws.runArtifactsPath(bRunId), 'copy.txt'), 'utf8')
  t.is(content.trim(), 'hello')
})

dockerTest('status returns running steps during execution', async t => {
  const workdir = await createTmpDir()
  const server = await startDaemon(workdir, 'status-test')
  t.teardown(async () => server.stop())

  // Subscribe first to detect when the step starts running
  const subscriber = await DaemonClient.connect(server.socketPath)
  t.teardown(async () => subscriber.disconnect())
  await subscriber.subscribe()

  const stepStarted = new Promise<void>(resolve => {
    subscriber.on('event', event => {
      if (event.event === 'STEP_STARTING') {
        resolve()
      }
    })
  })

  // Start a slow pipeline
  const runner = await DaemonClient.connect(server.socketPath)
  t.teardown(async () => runner.disconnect())

  await runner.run({
    id: 'status-test',
    root: workdir,
    steps: [
      {id: 'slow', image: 'alpine:3.20', cmd: ['sleep', '3']}
    ]
  }, {workspace: 'status-test'})

  // Wait for step to actually start before querying status
  await stepStarted

  // Query status while running
  const statusClient = await DaemonClient.connect(server.socketPath)
  t.teardown(async () => statusClient.disconnect())

  const state = await statusClient.status()
  t.is(state.status, 'running')

  // Steps are serialized as a plain object over the wire
  const steps: StepState[] = Object.values(state.steps)

  t.true(steps.length > 0)
  t.is(steps[0].id, 'slow')

  // Wait for completion
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out'))
    }, 15_000)
    subscriber.on('done', () => {
      clearTimeout(timer)
      resolve()
    })
  })
})

dockerTest('subscriber receives events from pipeline run', async t => {
  const workdir = await createTmpDir()
  const server = await startDaemon(workdir, 'sub-test')
  t.teardown(async () => server.stop())

  // Client 1: runs the pipeline
  const runner = await DaemonClient.connect(server.socketPath)
  t.teardown(async () => runner.disconnect())

  // Client 2: subscribes to events
  const subscriber = await DaemonClient.connect(server.socketPath)
  t.teardown(async () => subscriber.disconnect())
  await subscriber.subscribe()

  const subscriberEvents = collectEvents(subscriber)

  // Start pipeline from runner
  await runner.run({
    id: 'sub-test',
    root: workdir,
    steps: [
      {id: 'echo', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo hi > /output/hi.txt']}
    ]
  }, {workspace: 'sub-test'})

  // Wait for subscriber to get done
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out'))
    }, 15_000)
    subscriber.on('done', () => {
      clearTimeout(timer)
      resolve()
    })
    subscriber.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
  })

  const subEventTypes = new Set(subscriberEvents.map(e => e.event))
  t.true(subEventTypes.has('STEP_FINISHED'))
  t.true(subEventTypes.has('PIPELINE_FINISHED'))
})

dockerTest('Tylt.run() with lock guard creates workspace and commits artifacts', async t => {
  const workdir = await createTmpDir()
  // Import Tylt to test the full flow including lock guard
  const {Tylt} = await import('../tylt.js')

  const tylt = new Tylt({workdir, runtime: new DockerCliExecutor()})
  const pipeline = await tylt.load({
    id: 'lock-test',
    steps: [{id: 'write', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo locked > /output/out.txt']}]
  })

  await tylt.run(pipeline)

  // Verify artifacts are on disk (proves lock didn't break workspace creation)
  const ws = await tylt.workspace('lock-test')
  const info = await ws.show()
  t.is(info.length, 1)
  t.is(info[0].stepId, 'write')
  t.is(info[0].status, 'success')
})
