import test from 'ava'
import {MissingParameterError} from '../../errors.js'
import {shellKit} from '../../kits/shell.js'

// -- Defaults (no packages) --------------------------------------------------

test('resolve with run parameter uses alpine by default', async t => {
  const result = await shellKit.resolve({run: 'echo hello'})
  t.is(result.image, 'alpine:3.20')
  t.deepEqual(result.cmd, ['sh', '-c', 'echo hello'])
})

test('resolve without packages has no caches', async t => {
  const result = await shellKit.resolve({run: 'ls'})
  t.is(result.caches, undefined)
})

test('resolve without packages has no network', async t => {
  const result = await shellKit.resolve({run: 'ls'})
  t.is(result.allowNetwork, undefined)
})

test('resolve without packages has no setup', async t => {
  const result = await shellKit.resolve({run: 'ls'})
  t.is(result.setup, undefined)
})

// -- With packages ------------------------------------------------------------

test('resolve with packages defaults to debian', async t => {
  const result = await shellKit.resolve({run: 'ls', packages: ['curl']})
  t.is(result.image, 'debian:bookworm-slim')
})

test('resolve with packages puts apt-get in setup.cmd', async t => {
  const result = await shellKit.resolve({run: 'unzip archive.zip', packages: ['unzip', 'jq']})
  t.truthy(result.setup)
  t.truthy(result.setup!.cmd[2].includes('apt-get update'))
  t.truthy(result.setup!.cmd[2].includes('apt-get install -y --no-install-recommends unzip jq'))
})

test('resolve with packages cleans apt lists in setup', async t => {
  const result = await shellKit.resolve({run: 'ls', packages: ['curl']})
  t.truthy(result.setup!.cmd[2].includes('rm -rf /var/lib/apt/lists/*'))
})

test('resolve with packages has run cmd as just the user command', async t => {
  const result = await shellKit.resolve({run: 'my-command', packages: ['curl']})
  t.deepEqual(result.cmd, ['sh', '-c', 'my-command'])
})

test('resolve with packages includes apt-cache in setup.caches with exclusive', async t => {
  const result = await shellKit.resolve({run: 'ls', packages: ['curl']})
  t.deepEqual(result.setup!.caches, [{name: 'apt-cache', path: '/var/cache/apt', exclusive: true}])
})

test('resolve with packages enables network on setup', async t => {
  const result = await shellKit.resolve({run: 'ls', packages: ['curl']})
  t.true(result.setup!.allowNetwork)
})

test('resolve with packages has no top-level caches or allowNetwork', async t => {
  const result = await shellKit.resolve({run: 'ls', packages: ['curl']})
  t.is(result.caches, undefined)
  t.is(result.allowNetwork, undefined)
})

test('resolve with empty packages array behaves like no packages', async t => {
  const result = await shellKit.resolve({run: 'ls', packages: []})
  t.is(result.image, 'alpine:3.20')
  t.is(result.setup, undefined)
  t.is(result.caches, undefined)
  t.is(result.allowNetwork, undefined)
})

// -- Custom image -------------------------------------------------------------

test('resolve uses custom image', async t => {
  const result = await shellKit.resolve({run: 'ls', image: 'ubuntu:24.04'})
  t.is(result.image, 'ubuntu:24.04')
})

test('resolve custom image overrides debian default when packages set', async t => {
  const result = await shellKit.resolve({run: 'ls', packages: ['curl'], image: 'ubuntu:24.04'})
  t.is(result.image, 'ubuntu:24.04')
})

// -- Src mount ----------------------------------------------------------------

test('resolve with src adds mount', async t => {
  const result = await shellKit.resolve({run: 'ls', src: 'mydir'})
  t.deepEqual(result.mounts, [{host: 'mydir', container: '/app'}])
})

test('resolve without src has no mounts', async t => {
  const result = await shellKit.resolve({run: 'ls'})
  t.is(result.mounts, undefined)
})

// -- Validation ---------------------------------------------------------------

test('resolve throws MissingParameterError without run', async t => {
  const error = await t.throwsAsync(async () => shellKit.resolve({}), {message: /run.*required/i})
  t.true(error instanceof MissingParameterError)
})

test('resolve throws MissingParameterError without run even with packages', async t => {
  const error = await t.throwsAsync(async () => shellKit.resolve({packages: ['curl']}), {message: /run.*required/i})
  t.true(error instanceof MissingParameterError)
})
