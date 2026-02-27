import {Buffer} from 'node:buffer'
import {mkdir, writeFile, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {buffer as streamToBuffer} from 'node:stream/consumers'
import {pipeline} from 'node:stream/promises'
import test from 'ava'
import * as tar from 'tar'
import {BundleError} from '../errors.js'
import type {Kit, KitContext, Pipeline} from '../types.js'
import {PipelineLoader} from '../pipeline-loader.js'
import {collectDependencies, buildIgnoreFilter, buildBundle, extractBundle} from '../bundle.js'

// Fake kits for tests that use kit steps
const fakeShellKit: Kit = {
  name: 'shell',
  resolve(params) {
    const run = params.run as string
    return {image: 'alpine:3.20', cmd: ['sh', '-c', run]}
  }
}

const fakeNodeKit: Kit = {
  name: 'node',
  resolve(params) {
    const script = params.script as string | undefined
    const run = params.run as string | undefined
    const src = params.src as string | undefined
    const output: {image: string; cmd: string[]; sources?: Array<{host: string; container: string}>} = {
      image: 'node:24-alpine',
      cmd: ['sh', '-c', run ?? `node /app/${script!}`]
    }
    if (src) {
      output.sources = [{host: src, container: '/app'}]
    }

    return output
  }
}

const kits = new Map<string, Kit>([['shell', fakeShellKit], ['node', fakeNodeKit]])
const fakeKitContext: KitContext = {config: {}, cwd: '/tmp', kits}
const fakeKitLoader = new PipelineLoader(fakeKitContext)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `pipex-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(dir, {recursive: true})
  return dir
}

async function writePipeline(dir: string, definition: Record<string, unknown>, filename = 'pipeline.json'): Promise<string> {
  const filePath = join(dir, filename)
  await writeFile(filePath, JSON.stringify(definition))
  return filePath
}

async function listTarEntries(archive: Uint8Array): Promise<string[]> {
  const entries: string[] = []
  await pipeline(
    Readable.from(archive),
    tar.extract({
      cwd: tmpdir(),
      onReadEntry(entry) {
        entries.push(entry.path)
      }
    })
  )
  return entries
}

// ---------------------------------------------------------------------------
// collectDependencies
// ---------------------------------------------------------------------------

test('collectDependencies returns empty array for pipeline without mounts or sources', t => {
  const pipeline: Pipeline = {
    id: 'test',
    steps: [{id: 's', image: 'alpine', cmd: ['echo']}],
    root: '/tmp'
  }
  t.deepEqual(collectDependencies(pipeline), [])
})

test('collectDependencies collects from mounts', t => {
  const pipeline: Pipeline = {
    id: 'test',
    steps: [{
      id: 's',
      image: 'alpine',
      cmd: ['echo'],
      mounts: [{host: 'config', container: '/config'}]
    }],
    root: '/tmp'
  }
  t.deepEqual(collectDependencies(pipeline), ['config'])
})

test('collectDependencies collects from sources', t => {
  const pipeline: Pipeline = {
    id: 'test',
    steps: [{
      id: 's',
      image: 'alpine',
      cmd: ['echo'],
      sources: [{host: 'src', container: '/app'}]
    }],
    root: '/tmp'
  }
  t.deepEqual(collectDependencies(pipeline), ['src'])
})

test('collectDependencies collects from both mounts and sources', t => {
  const pipeline: Pipeline = {
    id: 'test',
    steps: [{
      id: 's',
      image: 'alpine',
      cmd: ['echo'],
      mounts: [{host: 'config', container: '/config'}],
      sources: [{host: 'src', container: '/app'}]
    }],
    root: '/tmp'
  }
  t.deepEqual(collectDependencies(pipeline), ['config', 'src'])
})

test('collectDependencies deduplicates same path from different steps', t => {
  const pipeline: Pipeline = {
    id: 'test',
    steps: [
      {
        id: 'a',
        image: 'alpine',
        cmd: ['echo'],
        mounts: [{host: 'data', container: '/data'}]
      },
      {
        id: 'b',
        image: 'alpine',
        cmd: ['echo'],
        sources: [{host: 'data', container: '/app/data'}]
      }
    ],
    root: '/tmp'
  }
  t.deepEqual(collectDependencies(pipeline), ['data'])
})

test('collectDependencies returns sorted results', t => {
  const pipeline: Pipeline = {
    id: 'test',
    steps: [{
      id: 's',
      image: 'alpine',
      cmd: ['echo'],
      mounts: [{host: 'zebra', container: '/z'}],
      sources: [{host: 'alpha', container: '/a'}]
    }],
    root: '/tmp'
  }
  t.deepEqual(collectDependencies(pipeline), ['alpha', 'zebra'])
})

test('collectDependencies normalizes paths', t => {
  const pipeline: Pipeline = {
    id: 'test',
    steps: [
      {
        id: 'a',
        image: 'alpine',
        cmd: ['echo'],
        mounts: [{host: './src/', container: '/app'}]
      },
      {
        id: 'b',
        image: 'alpine',
        cmd: ['echo'],
        sources: [{host: 'src', container: '/app'}]
      }
    ],
    root: '/tmp'
  }
  t.deepEqual(collectDependencies(pipeline), ['src'])
})

// ---------------------------------------------------------------------------
// buildIgnoreFilter
// ---------------------------------------------------------------------------

test('buildIgnoreFilter excludes .git by default', async t => {
  const dir = await createTempDir()
  try {
    const filter = await buildIgnoreFilter(dir)
    t.true(filter('.git'))
    t.true(filter('.git/config'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter excludes node_modules by default', async t => {
  const dir = await createTempDir()
  try {
    const filter = await buildIgnoreFilter(dir)
    t.true(filter('node_modules'))
    t.true(filter('node_modules/foo/index.js'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter excludes __pycache__ and .pyc by default', async t => {
  const dir = await createTempDir()
  try {
    const filter = await buildIgnoreFilter(dir)
    t.true(filter('__pycache__'))
    t.true(filter('test.pyc'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter excludes .DS_Store and .env by default', async t => {
  const dir = await createTempDir()
  try {
    const filter = await buildIgnoreFilter(dir)
    t.true(filter('.DS_Store'))
    t.true(filter('.env'))
    t.true(filter('src/.DS_Store'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter works without .gitignore', async t => {
  const dir = await createTempDir()
  try {
    // No .gitignore present — should not throw
    const filter = await buildIgnoreFilter(dir)
    t.true(filter('.git'))
    t.false(filter('src/app.js'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter excludes nested ignored paths', async t => {
  const dir = await createTempDir()
  try {
    const filter = await buildIgnoreFilter(dir)
    t.true(filter('src/.git'))
    t.true(filter('src/.git/config'))
    t.true(filter('lib/node_modules'))
    t.true(filter('lib/node_modules/pkg/index.js'))
    t.true(filter('src/__pycache__'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter returns false for empty string', async t => {
  const dir = await createTempDir()
  try {
    const filter = await buildIgnoreFilter(dir)
    t.false(filter(''))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter does not exclude normal files', async t => {
  const dir = await createTempDir()
  try {
    const filter = await buildIgnoreFilter(dir)
    t.false(filter('src/app.js'))
    t.false(filter('config/settings.yaml'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('buildIgnoreFilter respects .gitignore if present', async t => {
  const dir = await createTempDir()
  try {
    await writeFile(join(dir, '.gitignore'), 'dist/\n*.log\n')
    const filter = await buildIgnoreFilter(dir)
    t.true(filter('dist'))
    t.true(filter('dist/bundle.js'))
    t.true(filter('error.log'))
    t.false(filter('src/app.js'))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

// ---------------------------------------------------------------------------
// buildBundle + extractBundle round-trip
// ---------------------------------------------------------------------------

test('round-trip: pipeline with source directory', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    // Create source directory
    await mkdir(join(dir, 'src'), {recursive: true})
    await writeFile(join(dir, 'src', 'app.js'), 'console.log("hello")')

    // Create pipeline
    const pipelinePath = await writePipeline(dir, {
      id: 'test-pipeline',
      steps: [{
        id: 'build',
        image: 'node:24-alpine',
        cmd: ['node', 'app.js'],
        sources: [{host: 'src', container: '/app'}]
      }]
    })

    const archive = await buildBundle(pipelinePath)
    t.true(archive.length > 0)

    const pipeline = await extractBundle(archive, extractDir)
    t.is(pipeline.id, 'test-pipeline')
    t.is(pipeline.steps.length, 1)
    t.is(pipeline.steps[0].id, 'build')
    t.is(pipeline.steps[0].image, 'node:24-alpine')

    // Verify source files are extracted
    const content = await readFile(join(extractDir, 'src', 'app.js'), 'utf8')
    t.is(content, 'console.log("hello")')
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('round-trip: manifest contains resolved pipeline (no uses field)', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    // Create pipeline using a kit step
    const pipelinePath = await writePipeline(dir, {
      id: 'kit-pipeline',
      steps: [{
        id: 'run',
        uses: 'shell',
        with: {run: 'echo hello'}
      }]
    })

    const archive = await buildBundle(pipelinePath, fakeKitLoader)
    const pipeline = await extractBundle(archive, extractDir)

    // Manifest should have resolved step (image and cmd, no uses)
    t.is(pipeline.steps[0].image, 'alpine:3.20')
    t.deepEqual(pipeline.steps[0].cmd, ['sh', '-c', 'echo hello'])
    t.is((pipeline.steps[0] as any).uses, undefined)
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('round-trip: ignored files are not in the archive', async t => {
  const dir = await createTempDir()
  try {
    // Create source with ignored files
    await mkdir(join(dir, 'src', '.git'), {recursive: true})
    await mkdir(join(dir, 'src', 'node_modules', 'pkg'), {recursive: true})
    await writeFile(join(dir, 'src', 'app.js'), 'hello')
    await writeFile(join(dir, 'src', '.git', 'config'), 'git-data')
    await writeFile(join(dir, 'src', 'node_modules', 'pkg', 'index.js'), 'pkg')

    const pipelinePath = await writePipeline(dir, {
      id: 'test',
      steps: [{
        id: 's',
        image: 'alpine',
        cmd: ['echo'],
        sources: [{host: 'src', container: '/app'}]
      }]
    })

    const archive = await buildBundle(pipelinePath)
    const entries = await listTarEntries(archive)

    t.true(entries.includes('manifest.json'))
    t.true(entries.some(e => e.startsWith('src/') || e === 'src'))
    t.false(entries.some(e => e.includes('.git')))
    t.false(entries.some(e => e.includes('node_modules')))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('round-trip: manifest.json has correct structure', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    const pipelinePath = await writePipeline(dir, {
      id: 'my-pipeline',
      steps: [{
        id: 'step1',
        image: 'alpine',
        cmd: ['echo', 'hello']
      }]
    })

    const archive = await buildBundle(pipelinePath)
    await extractBundle(archive, extractDir)

    const manifest = JSON.parse(await readFile(join(extractDir, 'manifest.json'), 'utf8'))
    t.is(manifest.version, 1)
    t.is(manifest.pipeline.id, 'my-pipeline')
    t.truthy(manifest.pipeline.steps)
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('round-trip: pipeline with mounts bundles host directories', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    await mkdir(join(dir, 'config'), {recursive: true})
    await writeFile(join(dir, 'config', 'settings.yaml'), 'key: value')

    const pipelinePath = await writePipeline(dir, {
      id: 'mount-test',
      steps: [{
        id: 's',
        image: 'alpine',
        cmd: ['cat', '/config/settings.yaml'],
        mounts: [{host: 'config', container: '/config'}]
      }]
    })

    const archive = await buildBundle(pipelinePath)
    const p = await extractBundle(archive, extractDir)

    t.is(p.id, 'mount-test')
    const content = await readFile(join(extractDir, 'config', 'settings.yaml'), 'utf8')
    t.is(content, 'key: value')
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('round-trip: pipeline without deps produces manifest-only archive', async t => {
  const dir = await createTempDir()
  try {
    const pipelinePath = await writePipeline(dir, {
      id: 'no-deps',
      steps: [{
        id: 's',
        image: 'alpine',
        cmd: ['echo', 'hello']
      }]
    })

    const archive = await buildBundle(pipelinePath)
    const entries = await listTarEntries(archive)
    t.deepEqual(entries, ['manifest.json'])
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('round-trip: YAML pipeline file', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    await mkdir(join(dir, 'src'), {recursive: true})
    await writeFile(join(dir, 'src', 'app.js'), 'hello')

    const yamlContent = [
      'id: yaml-test',
      'steps:',
      '  - id: build',
      '    image: alpine',
      '    cmd: [echo, hello]',
      '    sources:',
      '      - host: src',
      '        container: /app'
    ].join('\n')
    const pipelinePath = join(dir, 'pipeline.yaml')
    await writeFile(pipelinePath, yamlContent)

    const archive = await buildBundle(pipelinePath)
    const p = await extractBundle(archive, extractDir)
    t.is(p.id, 'yaml-test')

    const content = await readFile(join(extractDir, 'src', 'app.js'), 'utf8')
    t.is(content, 'hello')
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('round-trip: multiple deps with nested directory structure', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    await mkdir(join(dir, 'scripts', 'nodejs'), {recursive: true})
    await mkdir(join(dir, 'scripts', 'python'), {recursive: true})
    await mkdir(join(dir, 'config'), {recursive: true})
    await writeFile(join(dir, 'scripts', 'nodejs', 'index.js'), 'node')
    await writeFile(join(dir, 'scripts', 'python', 'main.py'), 'python')
    await writeFile(join(dir, 'config', 'app.yaml'), 'config')

    const pipelinePath = await writePipeline(dir, {
      id: 'multi-deps',
      steps: [
        {
          id: 'a',
          image: 'node:22',
          cmd: ['node', 'index.js'],
          sources: [{host: 'scripts/nodejs', container: '/app'}]
        },
        {
          id: 'b',
          image: 'python:3',
          cmd: ['python', 'main.py'],
          sources: [{host: 'scripts/python', container: '/app'}],
          mounts: [{host: 'config', container: '/config'}]
        }
      ]
    })

    const archive = await buildBundle(pipelinePath)
    const p = await extractBundle(archive, extractDir)
    t.is(p.steps.length, 2)

    t.is(await readFile(join(extractDir, 'scripts', 'nodejs', 'index.js'), 'utf8'), 'node')
    t.is(await readFile(join(extractDir, 'scripts', 'python', 'main.py'), 'utf8'), 'python')
    t.is(await readFile(join(extractDir, 'config', 'app.yaml'), 'utf8'), 'config')
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('round-trip: .gitignore in pipeline root filters files from archive', async t => {
  const dir = await createTempDir()
  try {
    await mkdir(join(dir, 'src'), {recursive: true})
    await mkdir(join(dir, 'src', 'dist'), {recursive: true})
    await writeFile(join(dir, 'src', 'app.js'), 'hello')
    await writeFile(join(dir, 'src', 'dist', 'bundle.js'), 'bundled')
    await writeFile(join(dir, 'src', 'debug.log'), 'log data')
    await writeFile(join(dir, '.gitignore'), 'dist/\n*.log\n')

    const pipelinePath = await writePipeline(dir, {
      id: 'gitignore-test',
      steps: [{
        id: 's',
        image: 'alpine',
        cmd: ['echo'],
        sources: [{host: 'src', container: '/app'}]
      }]
    })

    const archive = await buildBundle(pipelinePath)
    const entries = await listTarEntries(archive)

    t.true(entries.some(e => e.includes('app.js')))
    t.false(entries.some(e => e.includes('dist')))
    t.false(entries.some(e => e.includes('debug.log')))
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('round-trip: kit step with src resolves sources into bundle', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    await mkdir(join(dir, 'myapp'), {recursive: true})
    await writeFile(join(dir, 'myapp', 'package.json'), '{"name":"test"}')
    await writeFile(join(dir, 'myapp', 'build.js'), 'console.log("build")')

    const pipelinePath = await writePipeline(dir, {
      id: 'kit-src',
      steps: [{
        id: 'build',
        uses: 'node',
        with: {script: 'build.js', src: 'myapp'}
      }]
    })

    const archive = await buildBundle(pipelinePath, fakeKitLoader)
    const p = await extractBundle(archive, extractDir)

    // Kit resolved: image is node, sources contain myapp
    t.truthy(p.steps[0].image.startsWith('node:'))
    t.truthy(p.steps[0].sources)
    t.is(p.steps[0].sources![0].host, 'myapp')

    // Files bundled
    t.is(await readFile(join(extractDir, 'myapp', 'package.json'), 'utf8'), '{"name":"test"}')
    t.is(await readFile(join(extractDir, 'myapp', 'build.js'), 'utf8'), 'console.log("build")')
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

// ---------------------------------------------------------------------------
// extractBundle edge cases
// ---------------------------------------------------------------------------

test('extractBundle creates target directory if it does not exist', async t => {
  const dir = await createTempDir()
  const nonExistentDir = join(dir, 'deep', 'nested', 'extract')
  try {
    const pipelinePath = await writePipeline(dir, {
      id: 'test',
      steps: [{id: 's', image: 'alpine', cmd: ['echo']}]
    })

    const archive = await buildBundle(pipelinePath)
    const p = await extractBundle(archive, nonExistentDir)
    t.is(p.id, 'test')

    // Directory was created
    const s = await stat(nonExistentDir)
    t.true(s.isDirectory())
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('extractBundle throws BundleError for invalid JSON in manifest', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    // Create a tar.gz with a malformed manifest.json
    await writeFile(join(dir, 'manifest.json'), '{not valid json')
    const stream = tar.create({cwd: dir, gzip: true}, ['manifest.json'])
    const archive = await streamToBuffer(stream)

    const error = await t.throwsAsync(
      async () => extractBundle(Buffer.from(archive), extractDir),
      {message: /not valid JSON/}
    )
    t.true(error instanceof BundleError)
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('extractBundle throws BundleError when manifest has no pipeline field', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({version: 1}))
    const stream = tar.create({cwd: dir, gzip: true}, ['manifest.json'])
    const archive = await streamToBuffer(stream)

    const error = await t.throwsAsync(
      async () => extractBundle(Buffer.from(archive), extractDir),
      {message: /missing pipeline/}
    )
    t.true(error instanceof BundleError)
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

test('buildBundle throws BundleError for missing dependency', async t => {
  const dir = await createTempDir()
  try {
    const pipelinePath = await writePipeline(dir, {
      id: 'test',
      steps: [{
        id: 's',
        image: 'alpine',
        cmd: ['echo'],
        sources: [{host: 'nonexistent', container: '/app'}]
      }]
    })

    const error = await t.throwsAsync(async () => buildBundle(pipelinePath), {
      message: /Dependency not found: nonexistent/
    })
    t.true(error instanceof BundleError)
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('extractBundle throws BundleError for corrupted archive', async t => {
  const dir = await createTempDir()
  try {
    const error = await t.throwsAsync(
      async () => extractBundle(Buffer.from('not-a-tar-archive'), dir)
    )
    t.truthy(error)
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})

test('extractBundle throws BundleError when manifest.json is missing', async t => {
  const dir = await createTempDir()
  const extractDir = await createTempDir()
  try {
    // Create a valid tar.gz without manifest.json
    await writeFile(join(dir, 'dummy.txt'), 'hello')
    const stream = tar.create({cwd: dir, gzip: true}, ['dummy.txt'])
    const {buffer} = await import('node:stream/consumers')
    const archive = await buffer(stream)

    const error = await t.throwsAsync(
      async () => extractBundle(Buffer.from(archive), extractDir),
      {message: /manifest\.json not found/}
    )
    t.true(error instanceof BundleError)
  } finally {
    await rm(dir, {recursive: true, force: true})
    await rm(extractDir, {recursive: true, force: true})
  }
})

test('buildBundle throws BundleError when archive exceeds 50 MB', async t => {
  const dir = await createTempDir()
  try {
    // Create a large file (tar with gzip compression, so we need significantly
    // more than 50MB of incompressible data)
    await mkdir(join(dir, 'data'), {recursive: true})

    // Write a large random-ish file that won't compress well
    const crypto = await import('node:crypto')
    const chunk = crypto.randomBytes(1024 * 1024) // 1MB of random data
    for (let i = 0; i < 55; i++) {
      await writeFile(join(dir, 'data', `file-${i}.bin`), chunk)
    }

    const pipelinePath = await writePipeline(dir, {
      id: 'large',
      steps: [{
        id: 's',
        image: 'alpine',
        cmd: ['echo'],
        sources: [{host: 'data', container: '/data'}]
      }]
    })

    const error = await t.throwsAsync(async () => buildBundle(pipelinePath), {
      message: /exceeds maximum/
    })
    t.true(error instanceof BundleError)
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})
