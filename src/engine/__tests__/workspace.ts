import {access, readdir, readlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import test from 'ava'
import {Workspace} from '../workspace.js'
import {WorkspaceError} from '../../errors.js'
import {createTmpDir} from '../../__tests__/helpers.js'

// -- create & open -----------------------------------------------------------

test('create makes staging/, runs/, caches/ directories', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'ws-1')
  const entries = await readdir(ws.root)
  t.true(entries.includes('staging'))
  t.true(entries.includes('runs'))
  t.true(entries.includes('caches'))
})

test('create with custom ID uses that ID', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'my-workspace')
  t.is(ws.id, 'my-workspace')
})

test('create without ID auto-generates one', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root)
  t.truthy(ws.id)
  t.true(ws.id.length > 0)
})

test('open returns workspace with correct id and root', async t => {
  const root = await createTmpDir()
  await Workspace.create(root, 'existing')
  const ws = await Workspace.open(root, 'existing')
  t.is(ws.id, 'existing')
  t.is(ws.root, join(root, 'existing'))
})

test('open throws if workspace missing', async t => {
  const root = await createTmpDir()
  await t.throwsAsync(async () => Workspace.open(root, 'nonexistent'))
})

// -- list & remove -----------------------------------------------------------

test('list returns sorted workspace IDs', async t => {
  const root = await createTmpDir()
  await Workspace.create(root, 'beta')
  await Workspace.create(root, 'alpha')
  await Workspace.create(root, 'gamma')
  const ids = await Workspace.list(root)
  t.deepEqual(ids, ['alpha', 'beta', 'gamma'])
})

test('list returns empty array if root does not exist', async t => {
  const ids = await Workspace.list('/tmp/nonexistent-pipex-root-' + Date.now())
  t.deepEqual(ids, [])
})

test('remove deletes workspace', async t => {
  const root = await createTmpDir()
  await Workspace.create(root, 'to-delete')
  await Workspace.remove(root, 'to-delete')
  const ids = await Workspace.list(root)
  t.false(ids.includes('to-delete'))
})

test('remove throws WorkspaceError on path traversal with ..', async t => {
  const root = await createTmpDir()
  const error = await t.throwsAsync(async () => Workspace.remove(root, '../etc'))
  t.true(error instanceof WorkspaceError)
})

test('remove throws WorkspaceError on path traversal with /', async t => {
  const error = await t.throwsAsync(async () => Workspace.remove('/tmp', 'a/b'))
  t.true(error instanceof WorkspaceError)
})

// -- run lifecycle: commit path ----------------------------------------------

test('prepareRun creates staging/{runId}/artifacts/', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'run-test')
  const runId = ws.generateRunId()
  await ws.prepareRun(runId)

  const stagingPath = ws.runStagingPath(runId)
  await t.notThrowsAsync(async () => access(stagingPath))
  await t.notThrowsAsync(async () => access(join(stagingPath, 'artifacts')))
})

test('commitRun moves staging to runs', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'commit-test')
  const runId = ws.generateRunId()
  await ws.prepareRun(runId)

  // Write a file into staging artifacts
  await writeFile(join(ws.runStagingArtifactsPath(runId), 'file.txt'), 'hello')
  await ws.commitRun(runId)

  // Committed run should exist
  await t.notThrowsAsync(async () => access(ws.runPath(runId)))
  await t.notThrowsAsync(async () => access(join(ws.runArtifactsPath(runId), 'file.txt')))
})

test('committed run appears in listRuns', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'list-runs')
  const runId = ws.generateRunId()
  await ws.prepareRun(runId)
  await ws.commitRun(runId)

  const runs = await ws.listRuns()
  t.true(runs.includes(runId))
})

test('staging is empty after commit', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'staging-empty')
  const runId = ws.generateRunId()
  await ws.prepareRun(runId)
  await ws.commitRun(runId)

  const staging = await readdir(join(ws.root, 'staging'))
  t.deepEqual(staging, [])
})

// -- run lifecycle: discard path ---------------------------------------------

test('discardRun removes staging directory', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'discard-test')
  const runId = ws.generateRunId()
  await ws.prepareRun(runId)
  await ws.discardRun(runId)

  const staging = await readdir(join(ws.root, 'staging'))
  t.deepEqual(staging, [])
})

test('discarded run does not appear in listRuns', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'discard-list')
  const runId = ws.generateRunId()
  await ws.prepareRun(runId)
  await ws.discardRun(runId)

  const runs = await ws.listRuns()
  t.false(runs.includes(runId))
})

// -- cleanupStaging ----------------------------------------------------------

test('cleanupStaging removes all staging dirs', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'cleanup-test')
  await ws.prepareRun(ws.generateRunId())
  await ws.prepareRun(ws.generateRunId())

  await ws.cleanupStaging()
  const staging = await readdir(join(ws.root, 'staging'))
  t.deepEqual(staging, [])
})

test('cleanupStaging is no-op when empty', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'cleanup-noop')
  await t.notThrowsAsync(async () => ws.cleanupStaging())
})

// -- linkRun -----------------------------------------------------------------

test('linkRun creates step-runs/{stepId} symlink', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'link-test')
  const runId = ws.generateRunId()
  await ws.prepareRun(runId)
  await ws.commitRun(runId)

  await ws.linkRun('my-step', runId)
  const linkDir = join(ws.root, 'step-runs')
  const entries = await readdir(linkDir)
  t.true(entries.includes('my-step'))
})

test('linkRun replaces existing symlink with new target', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'link-replace')

  const runId1 = ws.generateRunId()
  await ws.prepareRun(runId1)
  await ws.commitRun(runId1)
  await ws.linkRun('step-a', runId1)

  const runId2 = ws.generateRunId()
  await ws.prepareRun(runId2)
  await ws.commitRun(runId2)
  await ws.linkRun('step-a', runId2)

  // Symlink must point to the second run, not the first
  const target = await readlink(join(ws.root, 'step-runs', 'step-a'))
  t.true(target.includes(runId2))
  t.false(target.includes(runId1))
})

// -- pruneRuns ---------------------------------------------------------------

test('pruneRuns removes runs not in active set', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'prune-test')

  const keep = ws.generateRunId()
  await ws.prepareRun(keep)
  await ws.commitRun(keep)

  const remove = ws.generateRunId()
  await ws.prepareRun(remove)
  await ws.commitRun(remove)

  const removed = await ws.pruneRuns(new Set([keep]))
  t.is(removed, 1)

  const runs = await ws.listRuns()
  t.true(runs.includes(keep))
  t.false(runs.includes(remove))
})

test('pruneRuns keeps runs in active set', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'prune-keep')

  const run1 = ws.generateRunId()
  await ws.prepareRun(run1)
  await ws.commitRun(run1)

  const run2 = ws.generateRunId()
  await ws.prepareRun(run2)
  await ws.commitRun(run2)

  const removed = await ws.pruneRuns(new Set([run1, run2]))
  t.is(removed, 0)
})

// -- caches ------------------------------------------------------------------

test('prepareCache creates cache directory', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'cache-test')
  const path = await ws.prepareCache('npm-cache')
  await t.notThrowsAsync(async () => access(path))
})

test('listCaches lists cache names', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'cache-list')
  await ws.prepareCache('cache-a')
  await ws.prepareCache('cache-b')
  const caches = await ws.listCaches()
  t.true(caches.includes('cache-a'))
  t.true(caches.includes('cache-b'))
})

test('invalid cache name throws WorkspaceError', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'cache-invalid')
  const error = t.throws(() => ws.cachePath('invalid/name'))
  t.true(error instanceof WorkspaceError)
  t.true(error.message.includes('invalid/name'))
})

// -- validation --------------------------------------------------------------

test('invalid run ID in runStagingPath throws WorkspaceError', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'validate-staging')
  const error = t.throws(() => ws.runStagingPath('bad/id'))
  t.true(error instanceof WorkspaceError)
})

test('invalid run ID in runPath throws WorkspaceError', async t => {
  const root = await createTmpDir()
  const ws = await Workspace.create(root, 'validate-run')
  const error = t.throws(() => ws.runPath('bad id'))
  t.true(error instanceof WorkspaceError)
})
