import test from 'ava'
import {KitError, MissingParameterError} from '../../errors.js'
import {nodeKit} from '../../kits/node.js'

test('resolve with minimal params (script only)', async t => {
  const result = await nodeKit.resolve({script: 'index.js'})
  t.is(result.image, 'node:24-alpine')
  t.deepEqual(result.cmd, ['sh', '-c', 'node /app/index.js'])
  t.is(result.sources, undefined)
})

test('resolve uses default version and variant', async t => {
  const result = await nodeKit.resolve({script: 'app.js'})
  t.is(result.image, 'node:24-alpine')
})

test('resolve with npm package manager puts install in setup', async t => {
  const result = await nodeKit.resolve({script: 'app.js', packageManager: 'npm'})
  t.truthy(result.setup)
  t.truthy(result.setup!.cmd[2].includes('cd /app && npm install'))
  t.deepEqual(result.setup!.caches, [{name: 'npm-cache', path: '/root/.npm', exclusive: true}])
  t.true(result.setup!.allowNetwork)
})

test('resolve with npm has run cmd as just the script', async t => {
  const result = await nodeKit.resolve({script: 'app.js', packageManager: 'npm'})
  t.deepEqual(result.cmd, ['sh', '-c', 'node /app/app.js'])
})

test('resolve with pnpm package manager', async t => {
  const result = await nodeKit.resolve({script: 'app.js', packageManager: 'pnpm'})
  t.truthy(result.setup!.cmd[2].includes('pnpm install'))
  t.deepEqual(result.setup!.caches, [{name: 'pnpm-store', path: '/root/.local/share/pnpm/store', exclusive: true}])
})

test('resolve with yarn package manager', async t => {
  const result = await nodeKit.resolve({script: 'app.js', packageManager: 'yarn'})
  t.truthy(result.setup!.cmd[2].includes('yarn install'))
  t.deepEqual(result.setup!.caches, [{name: 'yarn-cache', path: '/usr/local/share/.cache/yarn', exclusive: true}])
})

test('resolve with install=false skips setup', async t => {
  const result = await nodeKit.resolve({script: 'app.js', install: false})
  t.is(result.setup, undefined)
  t.deepEqual(result.cmd, ['sh', '-c', 'node /app/app.js'])
})

test('resolve with install has no top-level caches or allowNetwork', async t => {
  const result = await nodeKit.resolve({script: 'app.js'})
  t.is(result.caches, undefined)
  t.is(result.allowNetwork, undefined)
})

test('resolve with src adds source', async t => {
  const result = await nodeKit.resolve({script: 'app.js', src: 'myapp'})
  t.deepEqual(result.sources, [{host: 'myapp', container: '/app'}])
  t.is(result.mounts, undefined)
})

test('resolve throws KitError on unsupported packageManager', async t => {
  const error = await t.throwsAsync(async () => nodeKit.resolve({script: 'app.js', packageManager: 'bun'}), {
    message: /unsupported packageManager/
  })
  t.true(error instanceof KitError)
})

test('resolve throws MissingParameterError without script or run', async t => {
  const error = await t.throwsAsync(async () => nodeKit.resolve({}), {message: /required/i})
  t.true(error instanceof MissingParameterError)
})

test('resolve throws KitError when both script and run are provided', async t => {
  const error = await t.throwsAsync(async () => nodeKit.resolve({script: 'app.js', run: 'npm run build'}), {
    message: /mutually exclusive/
  })
  t.true(error instanceof KitError)
})

// -- run parameter ------------------------------------------------------------

test('resolve with run uses the command directly', async t => {
  const result = await nodeKit.resolve({run: 'npm run build --prefix /app'})
  t.deepEqual(result.cmd, ['sh', '-c', 'npm run build --prefix /app'])
})

test('resolve with run still creates setup by default', async t => {
  const result = await nodeKit.resolve({run: 'npx eslint /app/src'})
  t.truthy(result.setup)
  t.truthy(result.setup!.cmd[2].includes('npm install'))
  t.deepEqual(result.cmd, ['sh', '-c', 'npx eslint /app/src'])
})

test('resolve with run and install=false skips setup', async t => {
  const result = await nodeKit.resolve({run: 'node --version', install: false})
  t.is(result.setup, undefined)
  t.deepEqual(result.cmd, ['sh', '-c', 'node --version'])
})
