import {Buffer} from 'node:buffer'
import {readFile, mkdir, writeFile, symlink, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, normalize, resolve, sep} from 'node:path'
import {pipeline} from 'node:stream/promises'
import {Readable} from 'node:stream'
import {buffer as streamToBuffer} from 'node:stream/consumers'
import ignore from 'ignore'
import * as tar from 'tar'
import {BundleError} from './errors.js'
import type {Pipeline} from './types.js'
import {PipelineLoader} from './pipeline-loader.js'

const MAX_BUNDLE_SIZE = 50 * 1024 * 1024 // 50 MB

const DEFAULT_IGNORES = [
  '.git',
  'node_modules',
  '__pycache__',
  '.DS_Store',
  '*.pyc',
  '.env'
]

const MANIFEST_VERSION = 1

type Manifest = {
  version: number;
  pipeline: Pipeline;
}

function normalizePath(p: string): string {
  const n = normalize(p)
  return n.endsWith(sep) ? n.slice(0, -1) : n
}

export function collectDependencies(pipeline: Pipeline): string[] {
  const paths = new Set<string>()

  for (const step of pipeline.steps) {
    if (step.mounts) {
      for (const mount of step.mounts) {
        paths.add(normalizePath(mount.host))
      }
    }

    if (step.sources) {
      for (const source of step.sources) {
        paths.add(normalizePath(source.host))
      }
    }
  }

  return [...paths].sort()
}

export async function buildIgnoreFilter(pipelineRoot: string): Promise<(path: string) => boolean> {
  const ig = ignore().add(DEFAULT_IGNORES)

  try {
    const gitignore = await readFile(resolve(pipelineRoot, '.gitignore'), 'utf8')
    ig.add(gitignore)
  } catch {}

  return (path: string) => {
    if (path === '') {
      return false
    }

    // Test both variants to handle directory-only patterns (e.g. "dist/")
    // which only match when the path has a trailing slash.
    return ig.ignores(path) || ig.ignores(path + '/')
  }
}

export async function buildBundle(pipelineFilePath: string): Promise<Uint8Array> {
  const absolutePath = resolve(pipelineFilePath)
  const pipelineRoot = dirname(absolutePath)

  const loader = new PipelineLoader()
  const pipeline = await loader.load(absolutePath)

  const deps = collectDependencies(pipeline)

  // Verify all dependencies exist
  for (const dep of deps) {
    const depPath = resolve(pipelineRoot, dep)
    try {
      await stat(depPath)
    } catch {
      throw new BundleError(`Dependency not found: ${dep}`)
    }
  }

  const shouldIgnore = await buildIgnoreFilter(pipelineRoot)

  const manifest: Manifest = {version: MANIFEST_VERSION, pipeline}
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n'

  // Use a staging directory with symlinks to combine manifest + deps in a single tar
  const stagingDir = join(tmpdir(), `pipex-bundle-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(stagingDir, {recursive: true})

  try {
    // Write manifest
    await writeFile(join(stagingDir, 'manifest.json'), manifestJson)

    // Symlink dependencies into staging
    for (const dep of deps) {
      const target = join(stagingDir, dep)
      await mkdir(dirname(target), {recursive: true})
      await symlink(resolve(pipelineRoot, dep), target)
    }

    // Create tar archive
    const entries = ['manifest.json', ...deps]
    const stream = tar.create(
      {
        cwd: stagingDir,
        gzip: true,
        follow: true,
        filter(path) {
          return !shouldIgnore(path)
        }
      },
      entries
    )

    const archiveBuffer = await streamToBuffer(stream)

    if (archiveBuffer.length > MAX_BUNDLE_SIZE) {
      throw new BundleError(
        `Bundle size (${archiveBuffer.length} bytes) exceeds maximum of ${MAX_BUNDLE_SIZE} bytes`
      )
    }

    return Buffer.from(archiveBuffer)
  } finally {
    await rm(stagingDir, {recursive: true, force: true})
  }
}

export async function extractBundle(archive: Uint8Array, targetDir: string): Promise<Pipeline> {
  await mkdir(targetDir, {recursive: true})

  await pipeline(
    Readable.from(archive),
    tar.extract({cwd: targetDir})
  )

  let manifestContent: string
  try {
    manifestContent = await readFile(resolve(targetDir, 'manifest.json'), 'utf8')
  } catch {
    throw new BundleError('Invalid bundle: manifest.json not found')
  }

  let manifest: Manifest
  try {
    manifest = JSON.parse(manifestContent) as Manifest
  } catch {
    throw new BundleError('Invalid bundle: manifest.json is not valid JSON')
  }

  if (!manifest.pipeline) {
    throw new BundleError('Invalid bundle: manifest.json missing pipeline')
  }

  return manifest.pipeline
}
