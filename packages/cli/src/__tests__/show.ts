import test from 'ava'
import {resolveShowSteps, type StepMeta} from '../commands/show.js'

// -- Helpers ------------------------------------------------------------------

function metaStore(entries: Record<string, StepMeta>): (runId: string) => Promise<StepMeta | undefined> {
  return async (runId: string) => entries[runId]
}

const alwaysAlive = () => true
const alwaysDead = () => false

// -- Only committed steps -----------------------------------------------------

test('committed success + failure → both statuses resolved from meta', async t => {
  const committed = [
    {stepId: 'build', runId: 'r1'},
    {stepId: 'test', runId: 'r2'}
  ]
  const loadMeta = metaStore({
    r1: {stepName: 'Build', status: 'success', durationMs: 1000, finishedAt: '2024-01-01T00:00:01Z', artifactBytes: 512},
    r2: {status: 'failure', durationMs: 2000, finishedAt: '2024-01-01T00:00:02Z', artifactBytes: 0}
  })

  const rows = await resolveShowSteps(committed, [], loadMeta, alwaysAlive)
  t.is(rows.length, 2)
  t.is(rows[0].status, 'success')
  t.is(rows[0].stepName, 'Build')
  t.is(rows[0].artifactBytes, 512)
  t.is(rows[1].status, 'failure')
})

test('committed step with missing meta → unknown status', async t => {
  const committed = [{stepId: 'build', runId: 'r1'}]
  // LoadMeta returns undefined — simulates missing/corrupt meta.json
  const loadMeta = metaStore({})

  const rows = await resolveShowSteps(committed, [], loadMeta, alwaysAlive)
  t.is(rows.length, 1)
  t.is(rows[0].status, 'unknown')
  t.is(rows[0].runId, 'r1')
})

// -- Only running steps -------------------------------------------------------

test('running steps with live PID → all shown as running', async t => {
  const running = [
    {stepId: 'build', startedAt: '2024-01-01T00:00:00Z', pid: 100, stepName: 'Build'},
    {stepId: 'test', startedAt: '2024-01-01T00:01:00Z', pid: 200}
  ]

  const rows = await resolveShowSteps([], running, metaStore({}), alwaysAlive)
  t.is(rows.length, 2)
  t.is(rows[0].status, 'running')
  t.is(rows[0].stepName, 'Build')
  t.is(rows[1].status, 'running')
  t.is(rows[1].stepId, 'test')
})

test('running step with dead PID → excluded', async t => {
  const running = [
    {stepId: 'build', startedAt: '2024-01-01T00:00:00Z', pid: 999}
  ]

  const rows = await resolveShowSteps([], running, metaStore({}), alwaysDead)
  t.is(rows.length, 0)
})

// -- Mixed: running overrides committed ---------------------------------------

test('re-executing step with live PID → running overrides committed success', async t => {
  const committed = [
    {stepId: 'build', runId: 'r1'},
    {stepId: 'test', runId: 'r2'}
  ]
  const loadMeta = metaStore({
    r1: {stepName: 'Build', status: 'success', durationMs: 1000, finishedAt: '2024-01-01T00:00:01Z', artifactBytes: 512},
    r2: {status: 'success', durationMs: 500, finishedAt: '2024-01-01T00:00:02Z', artifactBytes: 256}
  })
  const running = [
    {stepId: 'build', startedAt: '2024-01-01T00:10:00Z', pid: 100, stepName: 'Build'}
  ]

  const rows = await resolveShowSteps(committed, running, loadMeta, alwaysAlive)
  t.is(rows.length, 2)

  // Build: running overrides the committed success — meta NOT loaded
  t.is(rows[0].stepId, 'build')
  t.is(rows[0].status, 'running')
  t.is(rows[0].artifactBytes, 0)

  // Test: committed state preserved
  t.is(rows[1].stepId, 'test')
  t.is(rows[1].status, 'success')
  t.is(rows[1].artifactBytes, 256)
})

test('re-executing step with dead PID → committed state wins, meta loaded', async t => {
  const committed = [{stepId: 'build', runId: 'r1'}]
  const loadMeta = metaStore({
    r1: {stepName: 'Build', status: 'success', durationMs: 1000, finishedAt: '2024-01-01T00:00:01Z', artifactBytes: 512}
  })
  const running = [
    {stepId: 'build', startedAt: '2024-01-01T00:10:00Z', pid: 999}
  ]

  const rows = await resolveShowSteps(committed, running, loadMeta, alwaysDead)
  t.is(rows.length, 1)
  t.is(rows[0].status, 'success')
  t.is(rows[0].artifactBytes, 512)
})

test('new running step (not in state) → appended after committed', async t => {
  const committed = [{stepId: 'build', runId: 'r1'}]
  const loadMeta = metaStore({
    r1: {status: 'success', durationMs: 1000, finishedAt: '2024-01-01T00:00:01Z', artifactBytes: 256}
  })
  const running = [
    {stepId: 'test', startedAt: '2024-01-01T00:01:00Z', pid: 200}
  ]

  const rows = await resolveShowSteps(committed, running, loadMeta, alwaysAlive)
  t.is(rows.length, 2)
  t.is(rows[0].stepId, 'build')
  t.is(rows[0].status, 'success')
  t.is(rows[1].stepId, 'test')
  t.is(rows[1].status, 'running')
})

// -- Full mixed scenario ------------------------------------------------------

test('mixed: committed + override + dead PID + new running', async t => {
  const committed = [
    {stepId: 'a', runId: 'r1'},
    {stepId: 'b', runId: 'r2'},
    {stepId: 'c', runId: 'r3'}
  ]
  const loadMeta = metaStore({
    r1: {status: 'success', durationMs: 100, finishedAt: '2024-01-01T00:00:01Z', artifactBytes: 10},
    r2: {status: 'failure', durationMs: 200, finishedAt: '2024-01-01T00:00:02Z', artifactBytes: 20},
    r3: {status: 'success', durationMs: 300, finishedAt: '2024-01-01T00:00:03Z', artifactBytes: 30}
  })
  const running = [
    {stepId: 'b', startedAt: '2024-01-01T01:00:00Z', pid: 100, stepName: 'Build'},
    {stepId: 'c', startedAt: '2024-01-01T01:00:00Z', pid: 999},
    {stepId: 'd', startedAt: '2024-01-01T01:00:00Z', pid: 200, stepName: 'Deploy'}
  ]
  const isAlive = (pid: number) => pid !== 999

  const rows = await resolveShowSteps(committed, running, loadMeta, isAlive)
  t.is(rows.length, 4)

  // A: no running marker → committed success
  t.is(rows[0].stepId, 'a')
  t.is(rows[0].status, 'success')

  // B: alive PID → running overrides committed failure
  t.is(rows[1].stepId, 'b')
  t.is(rows[1].status, 'running')

  // C: dead PID → committed success (meta loaded)
  t.is(rows[2].stepId, 'c')
  t.is(rows[2].status, 'success')
  t.is(rows[2].artifactBytes, 30)

  // D: new running step, not in state → appended
  t.is(rows[3].stepId, 'd')
  t.is(rows[3].status, 'running')
  t.is(rows[3].stepName, 'Deploy')
})

// -- Edge cases ---------------------------------------------------------------

test('empty state and no running → empty result', async t => {
  const rows = await resolveShowSteps([], [], metaStore({}), alwaysAlive)
  t.is(rows.length, 0)
})

test('loadMeta is not called for running-overridden steps', async t => {
  const calledWith: string[] = []
  const loadMeta = async (runId: string): Promise<StepMeta> => {
    calledWith.push(runId)
    return {status: 'success', durationMs: 100, finishedAt: '2024-01-01T00:00:01Z', artifactBytes: 10}
  }

  const committed = [
    {stepId: 'build', runId: 'r1'},
    {stepId: 'test', runId: 'r2'}
  ]
  const running = [
    {stepId: 'build', startedAt: '2024-01-01T00:10:00Z', pid: 100}
  ]

  await resolveShowSteps(committed, running, loadMeta, alwaysAlive)

  // Only r2 (test) should have its meta loaded; r1 (build) is skipped because running
  t.deepEqual(calledWith, ['r2'])
})
