import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkdir, writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import test from 'ava'
import {KitError} from '../../errors.js'
import {resolveKit, type KitContext} from '../index.js'

// ---------------------------------------------------------------------------
// resolveKit — builtin resolution
// ---------------------------------------------------------------------------

test('resolveKit returns builtin without context', async t => {
  const kit = await resolveKit('node')
  t.is(kit.name, 'node')
})

test('resolveKit returns builtin with empty context', async t => {
  const context: KitContext = {config: {}, cwd: '/tmp'}
  const kit = await resolveKit('shell', context)
  t.is(kit.name, 'shell')
})

test('resolveKit throws on unknown kit without context', async t => {
  const error = await t.throwsAsync(async () => resolveKit('unknown'))
  t.true(error instanceof KitError)
  t.truthy(error?.message.includes('Unknown kit'))
})

// ---------------------------------------------------------------------------
// resolveKit — alias resolution
// ---------------------------------------------------------------------------

test('resolveKit resolves from alias (config)', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  await mkdir(dir, {recursive: true})

  const kitFile = join(dir, 'my-kit.js')
  await writeFile(kitFile, `export default function resolve(params) {
    return { image: 'test:1', cmd: ['echo', params.msg || 'hi'] }
  }`, 'utf8')

  const context: KitContext = {
    config: {kits: {'my-kit': kitFile}},
    cwd: dir
  }
  const kit = await resolveKit('my-kit', context)
  t.is(kit.name, 'my-kit')
  const output = kit.resolve({msg: 'hello'})
  t.is(output.image, 'test:1')
  t.deepEqual(output.cmd, ['echo', 'hello'])
})

// ---------------------------------------------------------------------------
// resolveKit — kits/ directory resolution
// ---------------------------------------------------------------------------

test('resolveKit resolves from kits/ directory', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  await mkdir(kitsDir, {recursive: true})

  await writeFile(join(kitsDir, 'custom.js'), `export default function resolve() {
    return { image: 'custom:latest', cmd: ['run'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('custom', context)
  t.is(kit.name, 'custom')
  t.is(kit.resolve({}).image, 'custom:latest')
})

test('resolveKit local file shadows builtin', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  await mkdir(kitsDir, {recursive: true})

  await writeFile(join(kitsDir, 'shell.js'), `export default function resolve() {
    return { image: 'my-shell:1', cmd: ['sh'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('shell', context)
  t.is(kit.resolve({}).image, 'my-shell:1')
})

// ---------------------------------------------------------------------------
// resolveKit — error cases
// ---------------------------------------------------------------------------

test('resolveKit throws KIT_INVALID_EXPORT when default is not a function', async t => {
  const dir = join(tmpdir(), `pipex-test-${randomUUID()}`)
  await mkdir(dir, {recursive: true})

  const kitFile = join(dir, 'bad-kit.js')
  await writeFile(kitFile, 'export default 42', 'utf8')

  const context: KitContext = {
    config: {kits: {'bad-kit': kitFile}},
    cwd: dir
  }
  const error = await t.throwsAsync(async () => resolveKit('bad-kit', context))
  t.true(error instanceof KitError)
  t.truthy(error?.message.includes('must export a default function'))
})

test('resolveKit throws KIT_LOAD_FAILED on broken alias', async t => {
  const context: KitContext = {
    config: {kits: {broken: '/nonexistent/kit.js'}},
    cwd: '/tmp'
  }
  const error = await t.throwsAsync(async () => resolveKit('broken', context))
  t.true(error instanceof KitError)
  t.truthy(error?.message.includes('Failed to load kit'))
})
