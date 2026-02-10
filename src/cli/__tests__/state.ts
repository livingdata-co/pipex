import test from 'ava'
import {StateManager} from '../state.js'

const base = {
  image: 'alpine:3.20',
  cmd: ['echo', 'hello']
}

test('fingerprint is deterministic', t => {
  const a = StateManager.fingerprint(base)
  const b = StateManager.fingerprint(base)
  t.is(a, b)
})

test('fingerprint sorts env keys', t => {
  const a = StateManager.fingerprint({...base, env: {A: '1', B: '2'}})
  const b = StateManager.fingerprint({...base, env: {B: '2', A: '1'}})
  t.is(a, b)
})

test('fingerprint sorts inputArtifactIds', t => {
  const a = StateManager.fingerprint({...base, inputArtifactIds: ['x', 'y']})
  const b = StateManager.fingerprint({...base, inputArtifactIds: ['y', 'x']})
  t.is(a, b)
})

test('fingerprint sorts mounts by containerPath', t => {
  const a = StateManager.fingerprint({
    ...base,
    mounts: [
      {hostPath: 'a', containerPath: '/a'},
      {hostPath: 'b', containerPath: '/b'}
    ]
  })
  const b = StateManager.fingerprint({
    ...base,
    mounts: [
      {hostPath: 'b', containerPath: '/b'},
      {hostPath: 'a', containerPath: '/a'}
    ]
  })
  t.is(a, b)
})

test('fingerprint differs when optional fields absent vs present', t => {
  const withEnv = StateManager.fingerprint({...base, env: {A: '1'}})
  const without = StateManager.fingerprint(base)
  t.not(withEnv, without)
})

test('fingerprint changes when image changes', t => {
  const a = StateManager.fingerprint(base)
  const b = StateManager.fingerprint({...base, image: 'node:24'})
  t.not(a, b)
})

test('fingerprint changes when cmd changes', t => {
  const a = StateManager.fingerprint(base)
  const b = StateManager.fingerprint({...base, cmd: ['echo', 'bye']})
  t.not(a, b)
})

test('fingerprint changes when env value changes', t => {
  const a = StateManager.fingerprint({...base, env: {A: '1'}})
  const b = StateManager.fingerprint({...base, env: {A: '2'}})
  t.not(a, b)
})
