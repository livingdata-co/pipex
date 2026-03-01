import process from 'node:process'
import {join} from 'node:path'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import test from 'ava'
import {createTmpDir} from './helpers.js'
import {WorkspaceLock} from '../daemon/workspace-lock.js'
import {WorkspaceLockedError} from '../errors.js'

test('acquire and release lifecycle', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')
  await mkdir(wsRoot, {recursive: true})

  const lock = await WorkspaceLock.acquire(wsRoot, '/tmp/test.sock')

  // Lock file should exist
  const content = await readFile(join(wsRoot, 'daemon.json'), 'utf8')
  const info = JSON.parse(content) as {pid: number; socketPath: string; version: number}
  t.is(info.pid, process.pid)
  t.is(info.socketPath, '/tmp/test.sock')
  t.is(info.version, 1)

  await lock.release()

  // Lock file should be gone
  const check = await WorkspaceLock.check(wsRoot)
  t.is(check, undefined)
})

test('double acquire throws WorkspaceLockedError', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')
  await mkdir(wsRoot, {recursive: true})

  const lock = await WorkspaceLock.acquire(wsRoot)
  t.teardown(async () => lock.release())

  const error = await t.throwsAsync(async () => WorkspaceLock.acquire(wsRoot))
  t.true(error instanceof WorkspaceLockedError)
})

test('stale lock from dead PID is cleaned up and re-acquirable', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')
  await mkdir(wsRoot, {recursive: true})

  // Write a stale lock with a PID that does not exist
  const staleLock = {pid: 999_999_999, socketPath: '/tmp/stale.sock', startedAt: new Date().toISOString(), version: 1}
  await writeFile(join(wsRoot, 'daemon.json'), JSON.stringify(staleLock), 'utf8')

  // Check should clean stale lock
  const result = await WorkspaceLock.check(wsRoot)
  t.is(result, undefined)

  // Acquire should succeed
  const lock = await WorkspaceLock.acquire(wsRoot)
  t.truthy(lock)
  await lock.release()
})

test('check returns undefined when unlocked', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')
  await mkdir(wsRoot, {recursive: true})

  const result = await WorkspaceLock.check(wsRoot)
  t.is(result, undefined)
})

test('check returns LockInfo when locked', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')
  await mkdir(wsRoot, {recursive: true})

  const lock = await WorkspaceLock.acquire(wsRoot, '/tmp/test.sock')
  t.teardown(async () => lock.release())

  const result = await WorkspaceLock.check(wsRoot)
  t.truthy(result)
  t.is(result!.pid, process.pid)
  t.is(result!.socketPath, '/tmp/test.sock')
  t.is(result!.version, 1)
})

test('release is idempotent', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')
  await mkdir(wsRoot, {recursive: true})

  const lock = await WorkspaceLock.acquire(wsRoot)
  await lock.release()
  await lock.release() // Should not throw
  t.pass()
})

test('acquire creates workspace directory if missing', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'nonexistent', 'ws')

  const lock = await WorkspaceLock.acquire(wsRoot)
  t.teardown(async () => lock.release())

  const result = await WorkspaceLock.check(wsRoot)
  t.truthy(result)
})
