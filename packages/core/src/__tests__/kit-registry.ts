import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkdir, writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import test from 'ava'
import {KitError} from '../errors.js'
import type {Kit, KitContext} from '../types.js'
import {resolveKit} from '../kit-registry.js'

// -- Test custom kit for use in tests -----------------------------------------

const fakeKit: Kit = {
  name: 'custom',
  resolve() {
    return {image: 'custom:1', cmd: ['echo', 'custom']}
  }
}

const kits = new Map<string, Kit>([['custom', fakeKit]])

// ---------------------------------------------------------------------------
// resolveKit — builtin resolution (always available)
// ---------------------------------------------------------------------------

test('resolveKit returns builtin without context', async t => {
  const kit = await resolveKit('shell')
  t.is(kit.name, 'shell')
})

test('resolveKit returns builtin with context', async t => {
  const context: KitContext = {config: {}, cwd: '/tmp'}
  const kit = await resolveKit('shell', context)
  t.is(kit.name, 'shell')
})

test('resolveKit throws on unknown kit without context', async t => {
  const error = await t.throwsAsync(async () => resolveKit('unknown'))
  t.true(error instanceof KitError)
  t.truthy(error?.message.includes('Unknown kit'))
})

test('resolveKit throws on unknown kit with context but no matching kit', async t => {
  const context: KitContext = {config: {}, cwd: '/tmp', kits}
  const error = await t.throwsAsync(async () => resolveKit('unknown', context))
  t.true(error instanceof KitError)
  t.truthy(error?.message.includes('Unknown kit'))
})

// ---------------------------------------------------------------------------
// resolveKit — custom kits from context
// ---------------------------------------------------------------------------

test('resolveKit returns custom kit from context.kits', async t => {
  const context: KitContext = {config: {}, cwd: '/tmp', kits}
  const kit = await resolveKit('custom', context)
  t.is(kit.name, 'custom')
})

// ---------------------------------------------------------------------------
// resolveKit — alias resolution
// ---------------------------------------------------------------------------

test('resolveKit resolves from alias (config)', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
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
  const output = await kit.resolve({msg: 'hello'})
  t.is(output.image, 'test:1')
  t.deepEqual(output.cmd, ['echo', 'hello'])
})

// ---------------------------------------------------------------------------
// resolveKit — kits/ directory resolution
// ---------------------------------------------------------------------------

test('resolveKit resolves from kits/ directory', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  await mkdir(kitsDir, {recursive: true})

  await writeFile(join(kitsDir, 'custom-file.js'), `export default function resolve() {
    return { image: 'custom:latest', cmd: ['run'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('custom-file', context)
  t.is(kit.name, 'custom-file')
  const output = await kit.resolve({})
  t.is(output.image, 'custom:latest')
})

test('resolveKit local file shadows builtin', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  await mkdir(kitsDir, {recursive: true})

  await writeFile(join(kitsDir, 'shell.js'), `export default function resolve() {
    return { image: 'my-shell:1', cmd: ['sh'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('shell', context)
  const output = await kit.resolve({})
  t.is(output.image, 'my-shell:1')
})

// ---------------------------------------------------------------------------
// resolveKit — error cases
// ---------------------------------------------------------------------------

test('resolveKit throws KIT_INVALID_EXPORT when default is not a function', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
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

// ---------------------------------------------------------------------------
// resolveKit — directory kits (kits/<name>/index.js)
// ---------------------------------------------------------------------------

test('resolveKit resolves from kits/<name>/index.js directory', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
  const kitDir = join(dir, 'kits', 'my-dir-kit')
  await mkdir(kitDir, {recursive: true})

  await writeFile(join(kitDir, 'index.js'), `export default function resolve() {
    return { image: 'dir-kit:1', cmd: ['run'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('my-dir-kit', context)
  t.is(kit.name, 'my-dir-kit')
  const output = await kit.resolve({})
  t.is(output.image, 'dir-kit:1')
})

test('resolveKit directory takes precedence over flat file', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  const kitSubDir = join(kitsDir, 'dual')
  await mkdir(kitSubDir, {recursive: true})

  // Flat file
  await writeFile(join(kitsDir, 'dual.js'), `export default function resolve() {
    return { image: 'flat:1', cmd: ['flat'] }
  }`, 'utf8')

  // Directory with index.js (should win)
  await writeFile(join(kitSubDir, 'index.js'), `export default function resolve() {
    return { image: 'dir:1', cmd: ['dir'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('dual', context)
  const output = await kit.resolve({})
  t.is(output.image, 'dir:1')
})

test('loaded kit has kitDir property', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  const kitSubDir = join(kitsDir, 'with-dir')
  await mkdir(kitSubDir, {recursive: true})

  await writeFile(join(kitSubDir, 'index.js'), `export default function resolve() {
    return { image: 'test:1', cmd: ['test'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('with-dir', context)
  t.is(kit.kitDir, kitSubDir)
})

test('loaded flat kit has kitDir pointing to kits/ directory', async t => {
  const dir = join(tmpdir(), `tylt-test-${randomUUID()}`)
  const kitsDir = join(dir, 'kits')
  await mkdir(kitsDir, {recursive: true})

  await writeFile(join(kitsDir, 'flat.js'), `export default function resolve() {
    return { image: 'flat:1', cmd: ['flat'] }
  }`, 'utf8')

  const context: KitContext = {config: {}, cwd: dir}
  const kit = await resolveKit('flat', context)
  t.is(kit.kitDir, kitsDir)
})
