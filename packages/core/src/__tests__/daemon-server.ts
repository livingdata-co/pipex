import process from 'node:process'
import {join} from 'node:path'
import {access} from 'node:fs/promises'
import test from 'ava'
import {createTmpDir} from './helpers.js'
import {DaemonServer} from '../daemon/daemon-server.js'
import {WorkspaceLock} from '../daemon/workspace-lock.js'
import {DaemonClient} from '../daemon/daemon-client.js'
import {DaemonError} from '../errors.js'

test('server acquires workspace lock and creates socket', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')

  const server = new DaemonServer({
    workspaceRoot: wsRoot,
    pipexOptions: {workdir: dir}
  })

  await server.start()
  t.teardown(async () => server.stop())

  // Socket file exists
  await access(server.socketPath)

  // Lock is held by current process
  const lockInfo = await WorkspaceLock.check(wsRoot)
  t.truthy(lockInfo)
  t.is(lockInfo!.pid, process.pid)
})

test('server cleans up socket and lock on stop', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')

  const server = new DaemonServer({
    workspaceRoot: wsRoot,
    pipexOptions: {workdir: dir}
  })

  await server.start()
  const {socketPath} = server

  await server.stop()

  await t.throwsAsync(async () => access(socketPath))

  const lockInfo = await WorkspaceLock.check(wsRoot)
  t.is(lockInfo, undefined)
})

test('status command returns error when no session is running', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')

  const server = new DaemonServer({
    workspaceRoot: wsRoot,
    pipexOptions: {workdir: dir}
  })

  await server.start()
  t.teardown(async () => server.stop())

  const client = await DaemonClient.connect(server.socketPath)
  t.teardown(async () => client.disconnect())

  const error = await t.throwsAsync(async () => client.status())
  t.true(error instanceof DaemonError)
  const message = error instanceof Error ? error.message : ''
  t.true(message.includes('No pipeline session found'))
})

test('client connect fails on non-existent socket', async t => {
  const error = await t.throwsAsync(async () => DaemonClient.connect('/tmp/nonexistent-pipex.sock'))
  t.true(error instanceof DaemonError)
})

test('client emits close when disconnected', async t => {
  const dir = await createTmpDir()
  const wsRoot = join(dir, 'ws')

  const server = new DaemonServer({
    workspaceRoot: wsRoot,
    pipexOptions: {workdir: dir}
  })

  await server.start()
  t.teardown(async () => server.stop())

  const client = await DaemonClient.connect(server.socketPath)

  const closePromise = new Promise<void>(resolve => {
    client.on('close', () => {
      resolve()
    })
  })

  await client.disconnect()
  await closePromise
  t.pass()
})
