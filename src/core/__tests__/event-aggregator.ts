import test from 'ava'
import {EventAggregator} from '../event-aggregator.js'
import type {TransportMessage} from '../transport.js'
import type {PipelineEvent} from '../reporter.js'

const workspaceId = 'ws-1'
const jobId = 'job-1'
let seq = 0

function msg(event: PipelineEvent): TransportMessage {
  return {
    seq: seq++,
    timestamp: new Date().toISOString(),
    version: 1,
    type: event.event,
    event
  }
}

test.beforeEach(() => {
  seq = 0
})

test('PIPELINE_START creates a session with pending steps', t => {
  const agg = new EventAggregator()
  agg.consume(msg({
    event: 'PIPELINE_START',
    workspaceId,
    jobId,
    pipelineName: 'my-pipeline',
    steps: [
      {id: 'a', displayName: 'Step A'},
      {id: 'b', displayName: 'Step B'}
    ]
  }))

  const session = agg.getSession(jobId)
  t.truthy(session)
  t.is(session!.workspaceId, workspaceId)
  t.is(session!.jobId, jobId)
  t.is(session!.pipelineName, 'my-pipeline')
  t.is(session!.status, 'running')
  t.is(session!.steps.size, 2)
  t.is(session!.steps.get('a')!.status, 'pending')
  t.is(session!.steps.get('b')!.status, 'pending')
})

test('STEP_STARTING transitions step to running', t => {
  const agg = new EventAggregator()
  agg.consume(msg({
    event: 'PIPELINE_START',
    workspaceId,
    jobId,
    pipelineName: 'test',
    steps: [{id: 'a', displayName: 'A'}]
  }))
  agg.consume(msg({
    event: 'STEP_STARTING',
    workspaceId,
    jobId,
    step: {id: 'a', displayName: 'A'}
  }))

  const step = agg.getSession(jobId)!.steps.get('a')!
  t.is(step.status, 'running')
})

test('STEP_FINISHED transitions step with metadata', t => {
  const agg = new EventAggregator()
  agg.consume(msg({
    event: 'PIPELINE_START',
    workspaceId,
    jobId,
    pipelineName: 'test',
    steps: [{id: 'a', displayName: 'A'}]
  }))
  agg.consume(msg({
    event: 'STEP_FINISHED',
    workspaceId,
    jobId,
    step: {id: 'a', displayName: 'A'},
    runId: 'run-123',
    durationMs: 500,
    artifactSize: 1024
  }))

  const step = agg.getSession(jobId)!.steps.get('a')!
  t.is(step.status, 'finished')
  t.is(step.runId, 'run-123')
  t.is(step.durationMs, 500)
  t.is(step.artifactSize, 1024)
})

test('STEP_FAILED transitions step with exitCode', t => {
  const agg = new EventAggregator()
  agg.consume(msg({
    event: 'PIPELINE_START',
    workspaceId,
    jobId,
    pipelineName: 'test',
    steps: [{id: 'a', displayName: 'A'}]
  }))
  agg.consume(msg({
    event: 'STEP_FAILED',
    workspaceId,
    jobId,
    step: {id: 'a', displayName: 'A'},
    exitCode: 1
  }))

  const step = agg.getSession(jobId)!.steps.get('a')!
  t.is(step.status, 'failed')
  t.is(step.exitCode, 1)
})

test('STEP_SKIPPED transitions step to skipped', t => {
  const agg = new EventAggregator()
  agg.consume(msg({
    event: 'PIPELINE_START',
    workspaceId,
    jobId,
    pipelineName: 'test',
    steps: [{id: 'a', displayName: 'A'}]
  }))
  agg.consume(msg({
    event: 'STEP_SKIPPED',
    workspaceId,
    jobId,
    step: {id: 'a', displayName: 'A'},
    runId: 'run-cached',
    reason: 'cached'
  }))

  const step = agg.getSession(jobId)!.steps.get('a')!
  t.is(step.status, 'skipped')
  t.is(step.runId, 'run-cached')
})

test('PIPELINE_FINISHED sets session to completed', t => {
  const agg = new EventAggregator()
  agg.consume(msg({
    event: 'PIPELINE_START',
    workspaceId,
    jobId,
    pipelineName: 'test',
    steps: []
  }))
  agg.consume(msg({
    event: 'PIPELINE_FINISHED',
    workspaceId,
    jobId,
    totalArtifactSize: 2048
  }))

  const session = agg.getSession(jobId)!
  t.is(session.status, 'completed')
  t.truthy(session.finishedAt)
})

test('PIPELINE_FAILED sets session to failed', t => {
  const agg = new EventAggregator()
  agg.consume(msg({
    event: 'PIPELINE_START',
    workspaceId,
    jobId,
    pipelineName: 'test',
    steps: []
  }))
  agg.consume(msg({
    event: 'PIPELINE_FAILED',
    workspaceId,
    jobId
  }))

  const session = agg.getSession(jobId)!
  t.is(session.status, 'failed')
  t.truthy(session.finishedAt)
})

test('getAllSessions returns all sessions', t => {
  const agg = new EventAggregator()
  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId: 'j1', pipelineName: 'p1', steps: []}))
  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId: 'j2', pipelineName: 'p2', steps: []}))

  t.is(agg.getAllSessions().length, 2)
})

test('clear removes all sessions', t => {
  const agg = new EventAggregator()
  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'test', steps: []}))
  agg.clear()

  t.is(agg.getAllSessions().length, 0)
  t.is(agg.getSession(jobId), undefined)
})

test('getSession returns undefined for unknown jobId', t => {
  const agg = new EventAggregator()
  t.is(agg.getSession('nonexistent'), undefined)
})

test('full lifecycle: start → running → finished → completed', t => {
  const agg = new EventAggregator()
  const step = {id: 'a', displayName: 'A'}

  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'full', steps: [step]}))
  t.is(agg.getSession(jobId)!.steps.get('a')!.status, 'pending')

  agg.consume(msg({event: 'STEP_STARTING', workspaceId, jobId, step}))
  t.is(agg.getSession(jobId)!.steps.get('a')!.status, 'running')

  agg.consume(msg({event: 'STEP_FINISHED', workspaceId, jobId, step, runId: 'r1', durationMs: 100, artifactSize: 50}))
  t.is(agg.getSession(jobId)!.steps.get('a')!.status, 'finished')

  agg.consume(msg({event: 'PIPELINE_FINISHED', workspaceId, jobId, totalArtifactSize: 50}))
  t.is(agg.getSession(jobId)!.status, 'completed')
  t.truthy(agg.getSession(jobId)!.startedAt)
  t.truthy(agg.getSession(jobId)!.finishedAt)
})

test('multiple steps tracked independently', t => {
  const agg = new EventAggregator()
  const steps = [{id: 'a', displayName: 'A'}, {id: 'b', displayName: 'B'}]

  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'multi', steps}))
  agg.consume(msg({event: 'STEP_STARTING', workspaceId, jobId, step: steps[0]}))
  agg.consume(msg({event: 'STEP_FINISHED', workspaceId, jobId, step: steps[0], runId: 'r1', durationMs: 100}))
  agg.consume(msg({event: 'STEP_STARTING', workspaceId, jobId, step: steps[1]}))
  agg.consume(msg({event: 'STEP_FAILED', workspaceId, jobId, step: steps[1], exitCode: 2}))

  const session = agg.getSession(jobId)!
  t.is(session.steps.get('a')!.status, 'finished')
  t.is(session.steps.get('b')!.status, 'failed')
  t.is(session.steps.get('b')!.exitCode, 2)
})

test('STEP_RETRYING is consumed without error', t => {
  const agg = new EventAggregator()
  const step = {id: 'a', displayName: 'A'}

  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'retry', steps: [step]}))
  t.notThrows(() => {
    agg.consume(msg({event: 'STEP_RETRYING', workspaceId, jobId, step, attempt: 1, maxRetries: 3}))
  })
})

test('STEP_WOULD_RUN is consumed without error', t => {
  const agg = new EventAggregator()
  const step = {id: 'a', displayName: 'A'}

  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'dry', steps: [step]}))
  t.notThrows(() => {
    agg.consume(msg({event: 'STEP_WOULD_RUN', workspaceId, jobId, step}))
  })
})

test('step event without prior PIPELINE_START creates session lazily', t => {
  const agg = new EventAggregator()
  const step = {id: 'x', displayName: 'X'}

  agg.consume(msg({event: 'STEP_STARTING', workspaceId, jobId: 'orphan', step}))

  const session = agg.getSession('orphan')
  t.truthy(session)
  t.is(session!.status, 'running')
  t.is(session!.steps.get('x')!.status, 'running')
})

test('startedAt is set from PIPELINE_START message timestamp', t => {
  const agg = new EventAggregator()
  const m = msg({event: 'PIPELINE_START', workspaceId, jobId, pipelineName: 'ts', steps: []})
  agg.consume(m)

  t.is(agg.getSession(jobId)!.startedAt, m.timestamp)
})

test('two independent jobs are tracked separately', t => {
  const agg = new EventAggregator()
  const step = {id: 'a', displayName: 'A'}

  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId: 'j1', pipelineName: 'p1', steps: [step]}))
  agg.consume(msg({event: 'PIPELINE_START', workspaceId, jobId: 'j2', pipelineName: 'p2', steps: [step]}))

  agg.consume(msg({event: 'STEP_FINISHED', workspaceId, jobId: 'j1', step, runId: 'r1'}))
  agg.consume(msg({event: 'STEP_FAILED', workspaceId, jobId: 'j2', step, exitCode: 1}))

  t.is(agg.getSession('j1')!.steps.get('a')!.status, 'finished')
  t.is(agg.getSession('j2')!.steps.get('a')!.status, 'failed')
})
