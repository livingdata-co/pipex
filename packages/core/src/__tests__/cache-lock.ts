import test from 'ava'
import {CacheLockManager} from '../cache-lock.js'

test('acquire and release a single lock', async t => {
  const mgr = new CacheLockManager()
  const release = await mgr.acquire(['a'])
  release()
  // Can acquire again after release
  const release2 = await mgr.acquire(['a'])
  release2()
  t.pass()
})

test('second acquire waits until first is released', async t => {
  const mgr = new CacheLockManager()
  const order: string[] = []

  const release1 = await mgr.acquire(['x'])
  order.push('acquired-1')

  const second = (async () => {
    const release2 = await mgr.acquire(['x'])
    order.push('acquired-2')
    release2()
  })()

  // Give second acquire a chance to start waiting
  await new Promise(resolve => {
    globalThis.setTimeout(resolve, 10)
  })
  t.deepEqual(order, ['acquired-1'])

  release1()
  await second

  t.deepEqual(order, ['acquired-1', 'acquired-2'])
})

test('multiple locks acquired in sorted order', async t => {
  const mgr = new CacheLockManager()
  // Even if names are passed unsorted, acquisition should be consistent
  const release = await mgr.acquire(['c', 'a', 'b'])
  release()
  // Reverse order should also work without deadlock
  const release2 = await mgr.acquire(['b', 'a', 'c'])
  release2()
  t.pass()
})

test('release is idempotent', async t => {
  const mgr = new CacheLockManager()
  const release = await mgr.acquire(['a'])
  release()
  release() // Should not throw
  t.pass()
})

test('independent locks do not contend', async t => {
  const mgr = new CacheLockManager()
  const release1 = await mgr.acquire(['a'])
  const release2 = await mgr.acquire(['b'])
  release1()
  release2()
  t.pass()
})

test('concurrent contention resolves in order', async t => {
  const mgr = new CacheLockManager()
  const order: number[] = []

  const release1 = await mgr.acquire(['shared'])

  const p2 = (async () => {
    const release = await mgr.acquire(['shared'])
    order.push(2)
    release()
  })()

  const p3 = (async () => {
    // Small delay so p2 starts waiting first
    await new Promise(resolve => {
      globalThis.setTimeout(resolve, 5)
    })
    const release = await mgr.acquire(['shared'])
    order.push(3)
    release()
  })()

  release1()
  await Promise.all([p2, p3])

  t.is(order.length, 2)
  t.is(order[0], 2)
  t.is(order[1], 3)
})
