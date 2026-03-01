import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import test from 'ava'
import {Workspace} from '../engine/workspace.js'
import {StateManager} from '../state.js'
import {Tylt} from '../tylt.js'
import {createTmpDir} from './helpers.js'

// -- workspace -----------------------------------------------------------

test('workspace() opens an existing workspace as TyltWorkspace', async t => {
  const tmpDir = await createTmpDir()
  const workspace = await Workspace.create(tmpDir, 'my-ws')
  const state = new StateManager(workspace.root)
  await state.load()
  state.setStep('step1', 'run-1', 'fp-1')
  await state.save()

  const tylt = new Tylt({workdir: tmpDir})
  const ws = await tylt.workspace('my-ws')

  t.is(ws.name, 'my-ws')
  const steps = await ws.show()
  t.is(steps.length, 1)
  t.is(steps[0].stepId, 'step1')
})

test('workspace() throws for nonexistent workspace', async t => {
  const tmpDir = await createTmpDir()
  const tylt = new Tylt({workdir: tmpDir})
  await t.throwsAsync(async () => tylt.workspace('nope'))
})

// -- workspaces ----------------------------------------------------------

test('workspaces() lists all workspaces with info', async t => {
  const tmpDir = await createTmpDir()
  const ws1 = await Workspace.create(tmpDir, 'alpha')
  await Workspace.create(tmpDir, 'beta')

  // Add a run to alpha
  const runDir = join(ws1.root, 'runs', 'run-1')
  await mkdir(join(runDir, 'artifacts'), {recursive: true})
  await writeFile(join(runDir, 'artifacts', 'out.txt'), 'data', 'utf8')

  const tylt = new Tylt({workdir: tmpDir})
  const workspaces = await tylt.workspaces()

  t.is(workspaces.length, 2)

  const alpha = workspaces.find(w => w.name === 'alpha')!
  t.is(alpha.runs, 1)
  t.true(alpha.size > 0)

  const beta = workspaces.find(w => w.name === 'beta')!
  t.is(beta.runs, 0)
})

test('workspaces() returns empty for missing workdir', async t => {
  const tmpDir = await createTmpDir()
  const tylt = new Tylt({workdir: join(tmpDir, 'nonexistent')})
  const workspaces = await tylt.workspaces()
  t.deepEqual(workspaces, [])
})

// -- removeWorkspace -----------------------------------------------------

test('removeWorkspace() removes a workspace', async t => {
  const tmpDir = await createTmpDir()
  await Workspace.create(tmpDir, 'to-remove')

  const tylt = new Tylt({workdir: tmpDir})
  await tylt.removeWorkspace('to-remove')

  const remaining = await Workspace.list(tmpDir)
  t.false(remaining.includes('to-remove'))
})

test('removeWorkspace() throws for nonexistent workspace', async t => {
  const tmpDir = await createTmpDir()
  const tylt = new Tylt({workdir: tmpDir})
  await t.throwsAsync(async () => tylt.removeWorkspace('nope'))
})

test('removeWorkspace() removes multiple workspaces', async t => {
  const tmpDir = await createTmpDir()
  await Workspace.create(tmpDir, 'a')
  await Workspace.create(tmpDir, 'b')
  await Workspace.create(tmpDir, 'c')

  const tylt = new Tylt({workdir: tmpDir})
  await tylt.removeWorkspace('a', 'b')

  const remaining = await Workspace.list(tmpDir)
  t.deepEqual(remaining, ['c'])
})

// -- clean ---------------------------------------------------------------

test('clean() removes all workspaces', async t => {
  const tmpDir = await createTmpDir()
  await Workspace.create(tmpDir, 'x')
  await Workspace.create(tmpDir, 'y')

  const tylt = new Tylt({workdir: tmpDir})
  await tylt.clean()

  const remaining = await Workspace.list(tmpDir)
  t.deepEqual(remaining, [])
})

test('clean() succeeds with no workspaces', async t => {
  const tmpDir = await createTmpDir()
  const tylt = new Tylt({workdir: tmpDir})
  await tylt.clean()

  const remaining = await Workspace.list(tmpDir)
  t.deepEqual(remaining, [])
})
