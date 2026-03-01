import test from 'ava'
import {PassThrough} from 'node:stream'
import {BroadcastReporter} from '../daemon/broadcast-reporter.js'
import {NdjsonDecoder} from '../daemon/ndjson.js'
import type {PipelineEvent} from '../reporter.js'

function createClientStream(): {stream: PassThrough; messages: unknown[]} {
  const stream = new PassThrough()
  const messages: unknown[] = []
  const decoder = new NdjsonDecoder()
  stream.pipe(decoder)
  decoder.on('data', (msg: unknown) => messages.push(msg))
  return {stream, messages}
}

const testEvent: PipelineEvent = {
  event: 'PIPELINE_START',
  workspaceId: 'test-ws',
  pipelineName: 'test',
  steps: [{id: 'a', displayName: 'Step A'}],
  jobId: 'job-1'
}

test('event emitted to single client', async t => {
  const reporter = new BroadcastReporter()
  const {stream, messages} = createClientStream()
  reporter.addClient(stream)

  reporter.emit(testEvent)

  // Allow async drain
  await new Promise(resolve => {
    setTimeout(resolve, 50)
  })

  t.is(messages.length, 1)
  t.is((messages[0] as {type: string; event: PipelineEvent}).type, 'event')
  t.deepEqual((messages[0] as {type: string; event: PipelineEvent}).event, testEvent)
})

test('event emitted to multiple clients', async t => {
  const reporter = new BroadcastReporter()
  const client1 = createClientStream()
  const client2 = createClientStream()
  reporter.addClient(client1.stream)
  reporter.addClient(client2.stream)

  reporter.emit(testEvent)

  await new Promise(resolve => {
    setTimeout(resolve, 50)
  })

  t.is(client1.messages.length, 1)
  t.is(client2.messages.length, 1)
})

test('removed client no longer receives events', async t => {
  const reporter = new BroadcastReporter()
  const {stream, messages} = createClientStream()
  reporter.addClient(stream)

  reporter.emit(testEvent)

  await new Promise(resolve => {
    setTimeout(resolve, 50)
  })

  t.is(messages.length, 1)

  reporter.removeClient(stream)
  reporter.emit(testEvent)

  await new Promise(resolve => {
    setTimeout(resolve, 50)
  })

  t.is(messages.length, 1)
})

test('clientCount tracks connected clients', t => {
  const reporter = new BroadcastReporter()
  t.is(reporter.clientCount, 0)

  const stream1 = new PassThrough()
  const stream2 = new PassThrough()
  reporter.addClient(stream1)
  t.is(reporter.clientCount, 1)

  reporter.addClient(stream2)
  t.is(reporter.clientCount, 2)

  reporter.removeClient(stream1)
  t.is(reporter.clientCount, 1)
})

test('client write error removes client (no crash)', async t => {
  const reporter = new BroadcastReporter()

  // Create a stream that is already destroyed
  const stream = new PassThrough()
  reporter.addClient(stream)
  stream.destroy()

  // Wait for the close event to propagate
  await new Promise(resolve => {
    setTimeout(resolve, 50)
  })

  // Should not throw and client should be removed
  t.is(reporter.clientCount, 0)
})

test('broadcast sends raw DaemonMessage to all clients', async t => {
  const reporter = new BroadcastReporter()
  const {stream, messages} = createClientStream()
  reporter.addClient(stream)

  reporter.broadcast({type: 'done', success: true})

  await new Promise(resolve => {
    setTimeout(resolve, 50)
  })

  t.is(messages.length, 1)
  t.deepEqual(messages[0], {type: 'done', success: true})
})

test('sendTo sends message to specific client', async t => {
  const reporter = new BroadcastReporter()
  const client1 = createClientStream()
  const client2 = createClientStream()
  reporter.addClient(client1.stream)
  reporter.addClient(client2.stream)

  reporter.sendTo(client1.stream, {type: 'ack', jobId: 'j1'})

  await new Promise(resolve => {
    setTimeout(resolve, 50)
  })

  t.is(client1.messages.length, 1)
  t.is(client2.messages.length, 0)
})
