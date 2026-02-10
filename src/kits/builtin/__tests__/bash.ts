import test from 'ava'
import {bashKit} from '../bash.js'

test('resolve with run parameter', t => {
  const result = bashKit.resolve({run: 'echo hello'})
  t.is(result.image, 'alpine:3.20')
  t.deepEqual(result.cmd, ['sh', '-c', 'echo hello'])
})

test('resolve uses default image', t => {
  const result = bashKit.resolve({run: 'ls'})
  t.is(result.image, 'alpine:3.20')
})

test('resolve uses custom image', t => {
  const result = bashKit.resolve({run: 'ls', image: 'ubuntu:24.04'})
  t.is(result.image, 'ubuntu:24.04')
})

test('resolve with src adds mount', t => {
  const result = bashKit.resolve({run: 'ls', src: 'mydir'})
  t.deepEqual(result.mounts, [{host: 'mydir', container: '/app'}])
})

test('resolve without src has no mounts', t => {
  const result = bashKit.resolve({run: 'ls'})
  t.is(result.mounts, undefined)
})

test('resolve throws without run', t => {
  t.throws(() => bashKit.resolve({}), {message: /run.*required/i})
})
