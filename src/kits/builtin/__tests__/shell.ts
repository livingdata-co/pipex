import test from 'ava'
import {MissingParameterError} from '../../../errors.js'
import {shellKit} from '../shell.js'

// -- Defaults (no packages) --------------------------------------------------

test('resolve with run parameter uses alpine by default', t => {
  const result = shellKit.resolve({run: 'echo hello'})
  t.is(result.image, 'alpine:3.20')
  t.deepEqual(result.cmd, ['sh', '-c', 'echo hello'])
})

test('resolve without packages has no caches', t => {
  const result = shellKit.resolve({run: 'ls'})
  t.is(result.caches, undefined)
})

test('resolve without packages has no network', t => {
  const result = shellKit.resolve({run: 'ls'})
  t.is(result.allowNetwork, undefined)
})

// -- With packages ------------------------------------------------------------

test('resolve with packages defaults to debian', t => {
  const result = shellKit.resolve({run: 'ls', packages: ['curl']})
  t.is(result.image, 'debian:bookworm-slim')
})

test('resolve with packages prepends apt-get install', t => {
  const result = shellKit.resolve({run: 'unzip archive.zip', packages: ['unzip', 'jq']})
  t.truthy(result.cmd[2].includes('apt-get update'))
  t.truthy(result.cmd[2].includes('apt-get install -y --no-install-recommends unzip jq'))
  t.truthy(result.cmd[2].includes('unzip archive.zip'))
})

test('resolve with packages cleans apt lists', t => {
  const result = shellKit.resolve({run: 'ls', packages: ['curl']})
  t.truthy(result.cmd[2].includes('rm -rf /var/lib/apt/lists/*'))
})

test('resolve with packages includes apt-cache', t => {
  const result = shellKit.resolve({run: 'ls', packages: ['curl']})
  t.deepEqual(result.caches, [{name: 'apt-cache', path: '/var/cache/apt'}])
})

test('resolve with packages enables network', t => {
  const result = shellKit.resolve({run: 'ls', packages: ['curl']})
  t.true(result.allowNetwork)
})

test('resolve with empty packages array behaves like no packages', t => {
  const result = shellKit.resolve({run: 'ls', packages: []})
  t.is(result.image, 'alpine:3.20')
  t.is(result.caches, undefined)
  t.is(result.allowNetwork, undefined)
  t.falsy(result.cmd[2].includes('apt-get'))
})

// -- Custom image -------------------------------------------------------------

test('resolve uses custom image', t => {
  const result = shellKit.resolve({run: 'ls', image: 'ubuntu:24.04'})
  t.is(result.image, 'ubuntu:24.04')
})

test('resolve custom image overrides debian default when packages set', t => {
  const result = shellKit.resolve({run: 'ls', packages: ['curl'], image: 'ubuntu:24.04'})
  t.is(result.image, 'ubuntu:24.04')
})

// -- Src mount ----------------------------------------------------------------

test('resolve with src adds mount', t => {
  const result = shellKit.resolve({run: 'ls', src: 'mydir'})
  t.deepEqual(result.mounts, [{host: 'mydir', container: '/app'}])
})

test('resolve without src has no mounts', t => {
  const result = shellKit.resolve({run: 'ls'})
  t.is(result.mounts, undefined)
})

// -- Validation ---------------------------------------------------------------

test('resolve throws MissingParameterError without run', t => {
  const error = t.throws(() => shellKit.resolve({}), {message: /run.*required/i})
  t.true(error instanceof MissingParameterError)
})

test('resolve throws MissingParameterError without run even with packages', t => {
  const error = t.throws(() => shellKit.resolve({packages: ['curl']}), {message: /run.*required/i})
  t.true(error instanceof MissingParameterError)
})
