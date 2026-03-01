import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkdir, writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import test from 'ava'
import {loadConfig} from '../config.js'

function tempDir(): string {
  return join(tmpdir(), `tylt-test-${randomUUID()}`)
}

test('loadConfig returns {} when no .tylt.yml', async t => {
  const dir = tempDir()
  await mkdir(dir, {recursive: true})
  const config = await loadConfig(dir)
  t.deepEqual(config, {})
})

test('loadConfig parses kit aliases', async t => {
  const dir = tempDir()
  await mkdir(dir, {recursive: true})
  await writeFile(join(dir, '.tylt.yml'), 'kits:\n  spark: "@myorg/analytics/spark"\n  rust: "./custom-kits/rust.js"\n', 'utf8')
  const config = await loadConfig(dir)
  t.deepEqual(config.kits, {
    spark: '@myorg/analytics/spark',
    rust: './custom-kits/rust.js'
  })
})

test('loadConfig returns {} for empty file', async t => {
  const dir = tempDir()
  await mkdir(dir, {recursive: true})
  await writeFile(join(dir, '.tylt.yml'), '', 'utf8')
  const config = await loadConfig(dir)
  t.deepEqual(config, {})
})

test('loadConfig throws on invalid YAML', async t => {
  const dir = tempDir()
  await mkdir(dir, {recursive: true})
  await writeFile(join(dir, '.tylt.yml'), ':\n  - :\n    bad: [', 'utf8')
  await t.throwsAsync(async () => loadConfig(dir))
})
