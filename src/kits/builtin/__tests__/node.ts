import test from 'ava'
import {nodeKit} from '../node.js'

test('resolve with minimal params (script only)', t => {
  const result = nodeKit.resolve({script: 'index.js'})
  t.is(result.image, 'node:24-alpine')
  t.truthy(result.cmd[2].includes('node /app/index.js'))
  t.is(result.shadowPaths, undefined)
})

test('resolve uses default version and variant', t => {
  const result = nodeKit.resolve({script: 'app.js'})
  t.is(result.image, 'node:24-alpine')
})

test('resolve with npm package manager', t => {
  const result = nodeKit.resolve({script: 'app.js', packageManager: 'npm'})
  t.truthy(result.cmd[2].includes('cd /app && npm install'))
  t.deepEqual(result.caches, [{name: 'npm-cache', path: '/root/.npm'}])
})

test('resolve with pnpm package manager', t => {
  const result = nodeKit.resolve({script: 'app.js', packageManager: 'pnpm'})
  t.truthy(result.cmd[2].includes('pnpm install'))
  t.deepEqual(result.caches, [{name: 'pnpm-store', path: '/root/.local/share/pnpm/store'}])
})

test('resolve with yarn package manager', t => {
  const result = nodeKit.resolve({script: 'app.js', packageManager: 'yarn'})
  t.truthy(result.cmd[2].includes('yarn install'))
  t.deepEqual(result.caches, [{name: 'yarn-cache', path: '/usr/local/share/.cache/yarn'}])
})

test('resolve with install=false skips install command', t => {
  const result = nodeKit.resolve({script: 'app.js', install: false})
  t.falsy(result.cmd[2].includes('npm install'))
  t.truthy(result.cmd[2].includes('node /app/app.js'))
})

test('resolve with src adds mount and shadowPaths', t => {
  const result = nodeKit.resolve({script: 'app.js', src: 'myapp'})
  t.deepEqual(result.mounts, [{host: 'myapp', container: '/app'}])
  t.deepEqual(result.shadowPaths, ['/app/node_modules'])
})

test('resolve sets allowNetwork to true', t => {
  const result = nodeKit.resolve({script: 'app.js'})
  t.true(result.allowNetwork)
})

test('resolve throws on unsupported packageManager', t => {
  t.throws(() => nodeKit.resolve({script: 'app.js', packageManager: 'bun'}), {
    message: /unsupported packageManager/
  })
})

test('resolve throws without script', t => {
  t.throws(() => nodeKit.resolve({}), {message: /script.*required/i})
})
