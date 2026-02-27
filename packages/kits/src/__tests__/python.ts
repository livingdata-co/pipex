import test from 'ava'
import {KitError, MissingParameterError} from '@livingdata/pipex-core'
import {pythonKit} from '../python.js'

test('resolve with minimal params (script only)', async t => {
  const result = await pythonKit.resolve({script: 'main.py'})
  t.is(result.image, 'python:3.12-slim')
  t.deepEqual(result.cmd, ['sh', '-c', 'python /app/main.py'])
})

test('resolve uses default version and variant', async t => {
  const result = await pythonKit.resolve({script: 'app.py'})
  t.is(result.image, 'python:3.12-slim')
})

test('resolve with pip package manager puts install in setup', async t => {
  const result = await pythonKit.resolve({script: 'app.py', packageManager: 'pip'})
  t.truthy(result.setup)
  t.truthy(result.setup!.cmd[2].includes('pip install'))
  t.deepEqual(result.setup!.caches, [{name: 'pip-cache', path: '/root/.cache/pip', exclusive: true}])
  t.true(result.setup!.allowNetwork)
})

test('resolve with pip has run cmd as just the script', async t => {
  const result = await pythonKit.resolve({script: 'app.py', packageManager: 'pip'})
  t.deepEqual(result.cmd, ['sh', '-c', 'python /app/app.py'])
})

test('resolve with uv package manager', async t => {
  const result = await pythonKit.resolve({script: 'app.py', packageManager: 'uv'})
  t.truthy(result.setup!.cmd[2].includes('uv pip install'))
  t.deepEqual(result.setup!.caches, [{name: 'uv-cache', path: '/root/.cache/uv', exclusive: true}])
})

test('resolve with install=false skips setup', async t => {
  const result = await pythonKit.resolve({script: 'app.py', install: false})
  t.is(result.setup, undefined)
  t.deepEqual(result.cmd, ['sh', '-c', 'python /app/app.py'])
})

test('resolve with install has no top-level caches or allowNetwork', async t => {
  const result = await pythonKit.resolve({script: 'app.py'})
  t.is(result.caches, undefined)
  t.is(result.allowNetwork, undefined)
})

test('resolve with src adds mount', async t => {
  const result = await pythonKit.resolve({script: 'app.py', src: 'myproject'})
  t.deepEqual(result.mounts, [{host: 'myproject', container: '/app'}])
})

test('resolve throws KitError on unsupported packageManager', async t => {
  const error = await t.throwsAsync(async () => pythonKit.resolve({script: 'app.py', packageManager: 'conda'}), {
    message: /unsupported packageManager/
  })
  t.true(error instanceof KitError)
})

test('resolve throws MissingParameterError without script or run', async t => {
  const error = await t.throwsAsync(async () => pythonKit.resolve({}), {message: /required/i})
  t.true(error instanceof MissingParameterError)
})

test('resolve throws KitError when both script and run are provided', async t => {
  const error = await t.throwsAsync(async () => pythonKit.resolve({script: 'app.py', run: 'pytest /app/tests'}), {
    message: /mutually exclusive/
  })
  t.true(error instanceof KitError)
})

// -- run parameter ------------------------------------------------------------

test('resolve with run uses the command directly', async t => {
  const result = await pythonKit.resolve({run: 'pytest /app/tests -v'})
  t.deepEqual(result.cmd, ['sh', '-c', 'pytest /app/tests -v'])
})

test('resolve with run still creates setup by default', async t => {
  const result = await pythonKit.resolve({run: 'pytest /app/tests'})
  t.truthy(result.setup)
  t.truthy(result.setup!.cmd[2].includes('pip install'))
  t.deepEqual(result.cmd, ['sh', '-c', 'pytest /app/tests'])
})

test('resolve with run and install=false skips setup', async t => {
  const result = await pythonKit.resolve({run: 'python --version', install: false})
  t.is(result.setup, undefined)
  t.deepEqual(result.cmd, ['sh', '-c', 'python --version'])
})
