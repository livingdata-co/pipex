import test from 'ava'
import {KitError, MissingParameterError} from '../../../errors.js'
import {pythonKit} from '../python.js'

test('resolve with minimal params (script only)', t => {
  const result = pythonKit.resolve({script: 'main.py'})
  t.is(result.image, 'python:3.12-slim')
  t.truthy(result.cmd[2].includes('python /app/main.py'))
})

test('resolve uses default version and variant', t => {
  const result = pythonKit.resolve({script: 'app.py'})
  t.is(result.image, 'python:3.12-slim')
})

test('resolve with pip package manager', t => {
  const result = pythonKit.resolve({script: 'app.py', packageManager: 'pip'})
  t.truthy(result.cmd[2].includes('pip install'))
  t.deepEqual(result.caches, [{name: 'pip-cache', path: '/root/.cache/pip'}])
})

test('resolve with uv package manager', t => {
  const result = pythonKit.resolve({script: 'app.py', packageManager: 'uv'})
  t.truthy(result.cmd[2].includes('uv pip install'))
  t.deepEqual(result.caches, [{name: 'uv-cache', path: '/root/.cache/uv'}])
})

test('resolve with install=false skips install command', t => {
  const result = pythonKit.resolve({script: 'app.py', install: false})
  t.falsy(result.cmd[2].includes('pip install'))
  t.truthy(result.cmd[2].includes('python /app/app.py'))
})

test('resolve with src adds mount', t => {
  const result = pythonKit.resolve({script: 'app.py', src: 'myproject'})
  t.deepEqual(result.mounts, [{host: 'myproject', container: '/app'}])
})

test('resolve sets allowNetwork to true', t => {
  const result = pythonKit.resolve({script: 'app.py'})
  t.true(result.allowNetwork)
})

test('resolve throws KitError on unsupported packageManager', t => {
  const error = t.throws(() => pythonKit.resolve({script: 'app.py', packageManager: 'conda'}), {
    message: /unsupported packageManager/
  })
  t.true(error instanceof KitError)
})

test('resolve throws MissingParameterError without script or run', t => {
  const error = t.throws(() => pythonKit.resolve({}), {message: /required/i})
  t.true(error instanceof MissingParameterError)
})

test('resolve throws KitError when both script and run are provided', t => {
  const error = t.throws(() => pythonKit.resolve({script: 'app.py', run: 'pytest /app/tests'}), {
    message: /mutually exclusive/
  })
  t.true(error instanceof KitError)
})

// -- run parameter ------------------------------------------------------------

test('resolve with run uses the command directly', t => {
  const result = pythonKit.resolve({run: 'pytest /app/tests -v'})
  t.truthy(result.cmd[2].includes('pytest /app/tests -v'))
  t.falsy(result.cmd[2].includes('python /app/'))
})

test('resolve with run still runs install by default', t => {
  const result = pythonKit.resolve({run: 'pytest /app/tests'})
  t.truthy(result.cmd[2].includes('pip install'))
  t.truthy(result.cmd[2].includes('pytest /app/tests'))
})

test('resolve with run and install=false skips install', t => {
  const result = pythonKit.resolve({run: 'python --version', install: false})
  t.falsy(result.cmd[2].includes('pip install'))
  t.is(result.cmd[2], 'python --version')
})
