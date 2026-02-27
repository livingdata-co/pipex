import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkdir, writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import test from 'ava'
import {resolveStep} from '../step-resolver.js'
import type {KitContext} from '../../kits/index.js'

// ---------------------------------------------------------------------------
// resolveKitStep — absolute path relativization
// ---------------------------------------------------------------------------

test('resolveKitStep converts absolute kit sources to pipelineRoot-relative', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  const kitSubDir = join(kitsDir, 'abs-kit')
  await mkdir(kitSubDir, {recursive: true})

  // Kit returns absolute paths in sources
  await writeFile(join(kitSubDir, 'index.js'), `
    export default function resolve(params) {
      return {
        image: 'test:1',
        cmd: ['run'],
        sources: [{ host: '${kitSubDir.replaceAll('\\', '/')}/src', container: '/app' }]
      }
    }
  `, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const step = await resolveStep(
    {id: 'test', uses: 'abs-kit'},
    context,
    dir
  )

  t.is(step.sources?.[0].host, 'kits/abs-kit/src')
  t.is(step.sources?.[0].container, '/app')
})

// ---------------------------------------------------------------------------
// resolveKitStep — KitResolveContext
// ---------------------------------------------------------------------------

test('resolveKitStep passes kitDir in KitResolveContext', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  const kitSubDir = join(kitsDir, 'ctx-kit')
  await mkdir(kitSubDir, {recursive: true})

  // Kit verifies it receives context.kitDir
  await writeFile(join(kitSubDir, 'index.js'), `
    export default function resolve(params, context) {
      return {
        image: 'test:1',
        cmd: ['echo', context ? context.kitDir : 'no-context']
      }
    }
  `, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const step = await resolveStep(
    {id: 'test', uses: 'ctx-kit'},
    context
  )

  t.deepEqual(step.cmd, ['echo', kitSubDir])
})

// ---------------------------------------------------------------------------
// resolveKitStep — chaining via resolveKit
// ---------------------------------------------------------------------------

test('resolveKitStep passes resolveKit for chaining', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  const kitSubDir = join(kitsDir, 'chain-kit')
  await mkdir(kitSubDir, {recursive: true})

  // Kit chains with the builtin shell kit
  await writeFile(join(kitSubDir, 'index.js'), `
    export default async function resolve(params, context) {
      const shell = await context.resolveKit('shell')
      const base = await shell.resolve({ run: 'echo base' })
      return {
        ...base,
        cmd: ['echo', 'chained'],
      }
    }
  `, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const step = await resolveStep(
    {id: 'test', uses: 'chain-kit'},
    context
  )

  t.is(step.image, 'alpine:3.20')
  t.deepEqual(step.cmd, ['echo', 'chained'])
})

// ---------------------------------------------------------------------------
// resolveKitStep — user mounts unchanged
// ---------------------------------------------------------------------------

test('resolveKitStep leaves user-provided relative paths unchanged', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  const kitSubDir = join(kitsDir, 'user-mount-kit')
  await mkdir(kitSubDir, {recursive: true})

  await writeFile(join(kitSubDir, 'index.js'), `
    export default function resolve() {
      return { image: 'test:1', cmd: ['run'] }
    }
  `, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const step = await resolveStep(
    {
      id: 'test',
      uses: 'user-mount-kit',
      mounts: [{host: 'data', container: '/data'}],
      sources: [{host: 'src', container: '/app'}]
    },
    context,
    dir
  )

  t.deepEqual(step.mounts, [{host: 'data', container: '/data'}])
  t.deepEqual(step.sources, [{host: 'src', container: '/app'}])
})
