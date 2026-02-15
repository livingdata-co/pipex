import test from 'ava'
import {InMemoryTransport, type TransportMessage} from '../transport.js'
import type {PipelineStartEvent} from '../reporter.js'

function makeMessage(seq: number, overrides?: Partial<TransportMessage>): TransportMessage {
  const event: PipelineStartEvent = {
    event: 'PIPELINE_START',
    workspaceId: 'ws-1',
    jobId: 'job-1',
    pipelineName: 'test',
    steps: []
  }

  return {
    seq,
    timestamp: new Date().toISOString(),
    version: 1,
    type: 'PIPELINE_START',
    event,
    ...overrides
  }
}

test('publish stores messages in order', async t => {
  const transport = new InMemoryTransport()
  await transport.publish(makeMessage(0))
  await transport.publish(makeMessage(1))

  t.is(transport.messages.length, 2)
  t.is(transport.messages[0].seq, 0)
  t.is(transport.messages[1].seq, 1)
})

test('clear removes all messages', async t => {
  const transport = new InMemoryTransport()
  await transport.publish(makeMessage(0))
  await transport.publish(makeMessage(1))

  transport.clear()
  t.is(transport.messages.length, 0)
})

test('publish after clear accumulates fresh', async t => {
  const transport = new InMemoryTransport()
  await transport.publish(makeMessage(0))
  transport.clear()
  await transport.publish(makeMessage(5))

  t.is(transport.messages.length, 1)
  t.is(transport.messages[0].seq, 5)
})

test('message content is preserved through publish', async t => {
  const transport = new InMemoryTransport()
  const message = makeMessage(0)
  await transport.publish(message)

  t.deepEqual(transport.messages[0], message)
  t.is(transport.messages[0].event.event, 'PIPELINE_START')
  t.is(transport.messages[0].version, 1)
})
