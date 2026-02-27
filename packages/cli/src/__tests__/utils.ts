import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'ava'
import {resolvePipelineFile} from '../utils.js'

// ---------------------------------------------------------------------------
// resolvePipelineFile
// ---------------------------------------------------------------------------

test('resolvePipelineFile: resolves pipeline.yml in directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pipex-test-'))
  try {
    await writeFile(join(dir, 'pipeline.yml'), 'id: test')
    const result = await resolvePipelineFile(dir)
    t.is(result, join(dir, 'pipeline.yml'))
  } finally {
    await rm(dir, {recursive: true})
  }
})

test('resolvePipelineFile: resolves pipeline.yaml in directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pipex-test-'))
  try {
    await writeFile(join(dir, 'pipeline.yaml'), 'id: test')
    const result = await resolvePipelineFile(dir)
    t.is(result, join(dir, 'pipeline.yaml'))
  } finally {
    await rm(dir, {recursive: true})
  }
})

test('resolvePipelineFile: resolves pipeline.json in directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pipex-test-'))
  try {
    await writeFile(join(dir, 'pipeline.json'), '{"id":"test"}')
    const result = await resolvePipelineFile(dir)
    t.is(result, join(dir, 'pipeline.json'))
  } finally {
    await rm(dir, {recursive: true})
  }
})

test('resolvePipelineFile: prefers yml over yaml and json', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pipex-test-'))
  try {
    await writeFile(join(dir, 'pipeline.yml'), 'id: yml')
    await writeFile(join(dir, 'pipeline.yaml'), 'id: yaml')
    await writeFile(join(dir, 'pipeline.json'), '{"id":"json"}')
    const result = await resolvePipelineFile(dir)
    t.is(result, join(dir, 'pipeline.yml'))
  } finally {
    await rm(dir, {recursive: true})
  }
})

test('resolvePipelineFile: returns file path directly when given a file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pipex-test-'))
  try {
    const filePath = join(dir, 'custom.yaml')
    await writeFile(filePath, 'id: test')
    const result = await resolvePipelineFile(filePath)
    t.is(result, filePath)
  } finally {
    await rm(dir, {recursive: true})
  }
})

test('resolvePipelineFile: throws when path does not exist', async t => {
  await t.throwsAsync(
    async () => resolvePipelineFile('/nonexistent/path'),
    {message: /Path does not exist/}
  )
})

test('resolvePipelineFile: throws when no pipeline file in directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pipex-test-'))
  try {
    await t.throwsAsync(
      async () => resolvePipelineFile(dir),
      {message: /No pipeline file found/}
    )
  } finally {
    await rm(dir, {recursive: true})
  }
})
