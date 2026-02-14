import test from 'ava'
import {StateManager} from '../state.js'
import {createTmpDir} from '../../__tests__/helpers.js'

// -- load / save round-trip --------------------------------------------------

test('load on missing file gives empty state, getStep returns undefined', async t => {
  const root = await createTmpDir()
  const sm = new StateManager(root)
  await sm.load()
  t.is(sm.getStep('any'), undefined)
})

test('setStep + save + new instance load returns same data', async t => {
  const root = await createTmpDir()

  const sm1 = new StateManager(root)
  await sm1.load()
  sm1.setStep('build', 'run-1', 'fp-abc')
  await sm1.save()

  const sm2 = new StateManager(root)
  await sm2.load()
  const step = sm2.getStep('build')
  t.truthy(step)
  t.is(step!.runId, 'run-1')
  t.is(step!.fingerprint, 'fp-abc')
})

test('removeStep + save + load removes the step', async t => {
  const root = await createTmpDir()

  const sm1 = new StateManager(root)
  await sm1.load()
  sm1.setStep('build', 'run-1', 'fp-1')
  sm1.setStep('test', 'run-2', 'fp-2')
  await sm1.save()

  const sm2 = new StateManager(root)
  await sm2.load()
  sm2.removeStep('build')
  await sm2.save()

  const sm3 = new StateManager(root)
  await sm3.load()
  t.is(sm3.getStep('build'), undefined)
  t.truthy(sm3.getStep('test'))
})

test('listSteps survives save/load round-trip', async t => {
  const root = await createTmpDir()
  const sm1 = new StateManager(root)
  await sm1.load()
  sm1.setStep('a', 'run-a', 'fp-a')
  sm1.setStep('b', 'run-b', 'fp-b')
  await sm1.save()

  const sm2 = new StateManager(root)
  await sm2.load()
  const steps = sm2.listSteps()
  t.is(steps.length, 2)
  t.truthy(steps.find(s => s.stepId === 'a' && s.runId === 'run-a'))
  t.truthy(steps.find(s => s.stepId === 'b' && s.runId === 'run-b'))
})

test('activeRunIds survives save/load round-trip', async t => {
  const root = await createTmpDir()
  const sm1 = new StateManager(root)
  await sm1.load()
  sm1.setStep('a', 'run-1', 'fp-a')
  sm1.setStep('b', 'run-2', 'fp-b')
  await sm1.save()

  const sm2 = new StateManager(root)
  await sm2.load()
  const ids = sm2.activeRunIds()
  t.true(ids.has('run-1'))
  t.true(ids.has('run-2'))
  t.is(ids.size, 2)
})

test('overwriting same stepId keeps only latest after reload', async t => {
  const root = await createTmpDir()

  const sm1 = new StateManager(root)
  await sm1.load()
  sm1.setStep('build', 'run-old', 'fp-old')
  sm1.setStep('build', 'run-new', 'fp-new')
  await sm1.save()

  const sm2 = new StateManager(root)
  await sm2.load()
  const step = sm2.getStep('build')
  t.is(step!.runId, 'run-new')
  t.is(step!.fingerprint, 'fp-new')
})
