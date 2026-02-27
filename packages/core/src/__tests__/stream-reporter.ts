import test from 'ava'
import {StreamReporter, CompositeReporter} from '../stream-reporter.js'
import {InMemoryTransport, type TransportMessage} from '../transport.js'
import type {PipelineEvent, Reporter} from '../reporter.js'

const jobId = 'test-job-1'
const workspaceId = 'ws-1'

test('publishes non-log events to transport', t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)

  reporter.emit({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: []})

  t.is(transport.messages.length, 1)
  t.is(transport.messages[0].event.event, 'PIPELINE_START')
  t.is(transport.messages[0].type, 'PIPELINE_START')
  t.is(transport.messages[0].version, 1)
})

test('ignores STEP_LOG events', t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)

  reporter.emit({
    event: 'STEP_LOG',
    workspaceId,
    jobId,
    step: {id: 's1', displayName: 's1'},
    stream: 'stdout',
    line: 'hello'
  })

  t.is(transport.messages.length, 0)
})

test('sequence numbers are monotonically increasing', t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)

  reporter.emit({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: []})
  reporter.emit({event: 'STEP_STARTING', workspaceId, jobId, step: {id: 's1', displayName: 's1'}})
  reporter.emit({event: 'PIPELINE_FINISHED', workspaceId, jobId, totalArtifactSize: 0})

  t.is(transport.messages[0].seq, 0)
  t.is(transport.messages[1].seq, 1)
  t.is(transport.messages[2].seq, 2)
})

test('timestamp is set on each message', t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)

  reporter.emit({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: []})

  t.truthy(transport.messages[0].timestamp)
  t.regex(transport.messages[0].timestamp, /^\d{4}-\d{2}-\d{2}T/)
})

test('flush calls transport.flush', async t => {
  let flushed = false
  const transport = {
    messages: [] as TransportMessage[],
    async publish(message: TransportMessage) {
      this.messages.push(message)
    },
    async flush() {
      flushed = true
    }
  }

  const reporter = new StreamReporter(transport)
  await reporter.flush()
  t.true(flushed)
})

test('CompositeReporter delegates to all reporters', t => {
  const events1: PipelineEvent[] = []
  const events2: PipelineEvent[] = []
  const r1: Reporter = {
    emit(e) {
      events1.push(e)
    }
  }

  const r2: Reporter = {
    emit(e) {
      events2.push(e)
    }
  }

  const composite = new CompositeReporter(r1, r2)
  composite.emit({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: []})

  t.is(events1.length, 1)
  t.is(events2.length, 1)
})

test('CompositeReporter with no reporters does not throw', t => {
  const composite = new CompositeReporter()
  t.notThrows(() => {
    composite.emit({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: []})
  })
})

test('STEP_LOG interleaved with other events does not affect sequence', t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)

  reporter.emit({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: []})
  reporter.emit({event: 'STEP_LOG', workspaceId, jobId, step: {id: 's1', displayName: 's1'}, stream: 'stdout', line: 'ignored'})
  reporter.emit({event: 'STEP_LOG', workspaceId, jobId, step: {id: 's1', displayName: 's1'}, stream: 'stderr', line: 'also ignored'})
  reporter.emit({event: 'STEP_STARTING', workspaceId, jobId, step: {id: 's1', displayName: 's1'}})

  t.is(transport.messages.length, 2)
  t.is(transport.messages[0].seq, 0)
  t.is(transport.messages[1].seq, 1)
})

test('event data is preserved in transport message', t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)
  const step = {id: 's1', displayName: 'Step One'}

  reporter.emit({event: 'STEP_FINISHED', workspaceId, jobId, step, runId: 'run-42', durationMs: 1234, artifactSize: 5678})

  const published = transport.messages[0]
  t.is(published.type, 'STEP_FINISHED')
  const ev = published.event
  t.is(ev.event, 'STEP_FINISHED')
  if (ev.event === 'STEP_FINISHED') {
    t.is(ev.runId, 'run-42')
    t.is(ev.durationMs, 1234)
    t.is(ev.artifactSize, 5678)
    t.deepEqual(ev.step, step)
  }
})

test('flush succeeds when transport has no flush method', async t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)

  await t.notThrowsAsync(async () => reporter.flush())
})

test('all non-log event types pass through StreamReporter', t => {
  const transport = new InMemoryTransport()
  const reporter = new StreamReporter(transport)
  const step = {id: 's1', displayName: 's1'}

  reporter.emit({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: [step]})
  reporter.emit({event: 'STEP_STARTING', workspaceId, jobId, step})
  reporter.emit({event: 'STEP_SKIPPED', workspaceId, jobId, step, reason: 'cached'})
  reporter.emit({event: 'STEP_FINISHED', workspaceId, jobId, step})
  reporter.emit({event: 'STEP_FAILED', workspaceId, jobId, step, exitCode: 1})
  reporter.emit({event: 'STEP_RETRYING', workspaceId, jobId, step, attempt: 1, maxRetries: 3})
  reporter.emit({event: 'STEP_WOULD_RUN', workspaceId, jobId, step})
  reporter.emit({event: 'PIPELINE_FINISHED', workspaceId, jobId, totalArtifactSize: 0})
  reporter.emit({event: 'PIPELINE_FAILED', workspaceId, jobId})

  t.is(transport.messages.length, 9)
  const types = transport.messages.map(m => m.type)
  t.deepEqual(types, [
    'PIPELINE_START',
    'STEP_STARTING',
    'STEP_SKIPPED',
    'STEP_FINISHED',
    'STEP_FAILED',
    'STEP_RETRYING',
    'STEP_WOULD_RUN',
    'PIPELINE_FINISHED',
    'PIPELINE_FAILED'
  ])
})
