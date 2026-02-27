import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import test from 'ava'
import {Workspace} from '../engine/workspace.js'
import {StateManager} from '../state.js'
import {PipexWorkspace} from '../pipex-workspace.js'
import {createTmpDir} from './helpers.js'

async function setupWorkspaceWithStep(): Promise<{
  ws: PipexWorkspace;
  workspace: Workspace;
  state: StateManager;
  tmpDir: string;
  runId: string;
}> {
  const tmpDir = await createTmpDir()
  const workspace = await Workspace.create(tmpDir, 'test-ws')
  const state = new StateManager(workspace.root)
  await state.load()

  // Create a committed run with artifacts and meta
  const runId = 'run-001'
  const runDir = join(workspace.root, 'runs', runId)
  const artifactsDir = join(runDir, 'artifacts')
  await mkdir(artifactsDir, {recursive: true})

  await writeFile(join(artifactsDir, 'output.txt'), 'hello world', 'utf8')
  await writeFile(join(runDir, 'stdout.log'), 'some stdout\n', 'utf8')
  await writeFile(join(runDir, 'stderr.log'), 'some stderr\n', 'utf8')
  await writeFile(join(runDir, 'meta.json'), JSON.stringify({
    runId,
    stepId: 'build',
    stepName: 'Build Step',
    status: 'success',
    durationMs: 1234,
    exitCode: 0,
    image: 'alpine:3.20',
    cmd: ['sh', '-c', 'echo hello'],
    startedAt: '2024-01-01T00:00:00.000Z',
    finishedAt: '2024-01-01T00:00:01.234Z',
    fingerprint: 'abc123'
  }), 'utf8')

  state.setStep('build', runId, 'abc123')
  await state.save()

  const ws = new PipexWorkspace(workspace, state)
  return {ws, workspace, state, tmpDir, runId}
}

// -- show ----------------------------------------------------------------

test('show returns steps with metadata', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const steps = await ws.show()

  t.is(steps.length, 1)
  t.is(steps[0].stepId, 'build')
  t.is(steps[0].status, 'success')
  t.is(steps[0].durationMs, 1234)
  t.is(steps[0].stepName, 'Build Step')
  t.is(steps[0].runId, 'run-001')
  t.truthy(steps[0].artifactSize)
})

test('show returns empty array for empty workspace', async t => {
  const tmpDir = await createTmpDir()
  const workspace = await Workspace.create(tmpDir, 'empty-ws')
  const state = new StateManager(workspace.root)
  await state.load()
  const ws = new PipexWorkspace(workspace, state)

  const steps = await ws.show()
  t.deepEqual(steps, [])
})

// -- logs ----------------------------------------------------------------

test('logs returns stdout content', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const stdout = await ws.logs('build', 'stdout')
  t.is(stdout, 'some stdout\n')
})

test('logs returns stderr content', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const stderr = await ws.logs('build', 'stderr')
  t.is(stderr, 'some stderr\n')
})

test('logs returns both streams concatenated by default', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const both = await ws.logs('build')
  t.true(both.includes('some stdout'))
  t.true(both.includes('some stderr'))
})

test('logs throws for unknown step', async t => {
  const {ws} = await setupWorkspaceWithStep()
  await t.throwsAsync(async () => ws.logs('nonexistent'))
})

// -- inspect -------------------------------------------------------------

test('inspect returns meta.json content', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const meta = await ws.inspect('build')

  t.is(meta.runId, 'run-001')
  t.is(meta.stepId, 'build')
  t.is(meta.status, 'success')
  t.is(meta.image, 'alpine:3.20')
  t.is(meta.exitCode, 0)
})

test('inspect throws for unknown step', async t => {
  const {ws} = await setupWorkspaceWithStep()
  await t.throwsAsync(async () => ws.inspect('nonexistent'))
})

// -- listArtifacts -------------------------------------------------------

test('listArtifacts returns file entries', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const entries = await ws.listArtifacts('build')

  t.is(entries.length, 1)
  t.is(entries[0].name, 'output.txt')
  t.is(entries[0].type, 'file')
  t.true(entries[0].size > 0)
})

test('listArtifacts with subdirectory', async t => {
  const {ws, workspace} = await setupWorkspaceWithStep()

  // Add a subdirectory
  const subDir = join(workspace.runArtifactsPath('run-001'), 'sub')
  await mkdir(subDir, {recursive: true})
  await writeFile(join(subDir, 'nested.txt'), 'nested', 'utf8')

  const entries = await ws.listArtifacts('build')
  t.is(entries.length, 2)

  const dirEntry = entries.find(e => e.name === 'sub')
  t.truthy(dirEntry)
  t.is(dirEntry!.type, 'directory')

  const subEntries = await ws.listArtifacts('build', 'sub')
  t.is(subEntries.length, 1)
  t.is(subEntries[0].name, 'nested.txt')
})

test('listArtifacts throws for unknown step', async t => {
  const {ws} = await setupWorkspaceWithStep()
  await t.throwsAsync(async () => ws.listArtifacts('nonexistent'))
})

// -- readArtifact --------------------------------------------------------

test('readArtifact returns file content', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const buf = await ws.readArtifact('build', 'output.txt')
  t.is(buf.toString(), 'hello world')
})

test('readArtifact throws for unknown step', async t => {
  const {ws} = await setupWorkspaceWithStep()
  await t.throwsAsync(async () => ws.readArtifact('nonexistent', 'file.txt'))
})

// -- exportArtifacts -----------------------------------------------------

test('exportArtifacts copies artifacts to dest', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const destDir = await createTmpDir()
  const dest = join(destDir, 'exported')

  await ws.exportArtifacts('build', dest)

  const {readFile} = await import('node:fs/promises')
  const content = await readFile(join(dest, 'output.txt'), 'utf8')
  t.is(content, 'hello world')
})

// -- prune ---------------------------------------------------------------

test('prune removes orphaned runs', async t => {
  const {ws, workspace} = await setupWorkspaceWithStep()

  // Add an orphaned run
  const orphanDir = join(workspace.root, 'runs', 'orphan-run')
  await mkdir(join(orphanDir, 'artifacts'), {recursive: true})
  await writeFile(join(orphanDir, 'artifacts', 'file.txt'), 'data', 'utf8')

  const result = await ws.prune()
  t.is(result.removed, 1)
  t.true(result.freedBytes > 0)

  // Active run still exists
  const runs = await workspace.listRuns()
  t.true(runs.includes('run-001'))
  t.false(runs.includes('orphan-run'))
})

test('prune returns 0 when nothing to remove', async t => {
  const {ws} = await setupWorkspaceWithStep()
  const result = await ws.prune()
  t.is(result.removed, 0)
  t.is(result.freedBytes, 0)
})

// -- removeStep ----------------------------------------------------------

test('removeStep removes run and state entry', async t => {
  const {ws, workspace} = await setupWorkspaceWithStep()

  await ws.removeStep('build')

  // State entry gone
  const reloaded = new StateManager(workspace.root)
  await reloaded.load()
  t.is(reloaded.getStep('build'), undefined)

  // Run directory gone
  const runs = await workspace.listRuns()
  t.false(runs.includes('run-001'))
})

test('removeStep throws for unknown step', async t => {
  const {ws} = await setupWorkspaceWithStep()
  await t.throwsAsync(async () => ws.removeStep('nonexistent'))
})

// -- remove --------------------------------------------------------------

test('remove deletes the workspace', async t => {
  const {ws, tmpDir} = await setupWorkspaceWithStep()

  await ws.remove()

  const {access} = await import('node:fs/promises')
  await t.throwsAsync(async () => access(join(tmpDir, 'test-ws')))
})

// -- name and root -------------------------------------------------------

test('name returns workspace id', async t => {
  const {ws} = await setupWorkspaceWithStep()
  t.is(ws.name, 'test-ws')
})

test('root returns workspace root path', async t => {
  const {ws, tmpDir} = await setupWorkspaceWithStep()
  t.is(ws.root, join(tmpDir, 'test-ws'))
})
