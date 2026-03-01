import {join} from 'node:path'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import test from 'ava'
import {loadEnvFile} from '../env-file.js'

let tempDir: string

test.beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tylt-env-'))
})

test.afterEach(async () => {
  await rm(tempDir, {recursive: true, force: true})
})

test('parses KEY=VALUE lines', async t => {
  const filePath = join(tempDir, '.env')
  await writeFile(filePath, 'FOO=bar\nBAZ=qux\n')
  const env = await loadEnvFile(filePath)
  t.deepEqual(env, {FOO: 'bar', BAZ: 'qux'})
})

test('ignores comments', async t => {
  const filePath = join(tempDir, '.env')
  await writeFile(filePath, '# this is a comment\nFOO=bar\n# another comment\n')
  const env = await loadEnvFile(filePath)
  t.deepEqual(env, {FOO: 'bar'})
})

test('ignores empty lines', async t => {
  const filePath = join(tempDir, '.env')
  await writeFile(filePath, '\nFOO=bar\n\nBAZ=qux\n\n')
  const env = await loadEnvFile(filePath)
  t.deepEqual(env, {FOO: 'bar', BAZ: 'qux'})
})

test('handles quoted values', async t => {
  const filePath = join(tempDir, '.env')
  await writeFile(filePath, 'FOO="bar baz"\nQUX=\'hello world\'\n')
  const env = await loadEnvFile(filePath)
  t.is(env.FOO, 'bar baz')
  t.is(env.QUX, 'hello world')
})

test('throws on missing file', async t => {
  const filePath = join(tempDir, 'nonexistent.env')
  await t.throwsAsync(async () => loadEnvFile(filePath), {code: 'ENOENT'})
})
