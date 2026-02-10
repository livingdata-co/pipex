import type {Kit, KitOutput} from '../index.js'

const cacheMap: Record<string, {name: string; path: string}> = {
  pip: {name: 'pip-cache', path: '/root/.cache/pip'},
  uv: {name: 'uv-cache', path: '/root/.cache/uv'}
}

function buildInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case 'pip': {
      return 'pip install --quiet -r /app/requirements.txt 2>&1'
    }

    case 'uv': {
      return 'uv pip install --quiet -r /app/requirements.txt 2>&1'
    }

    default: {
      throw new Error(`Kit "python": unsupported packageManager "${packageManager}"`)
    }
  }
}

export const pythonKit: Kit = {
  name: 'python',
  resolve(params) {
    const version = (params.version as string | undefined) ?? '3.12'
    const packageManager = (params.packageManager as string | undefined) ?? 'pip'
    const script = params.script as string | undefined
    const install = (params.install as boolean | undefined) ?? true
    const variant = (params.variant as string | undefined) ?? 'slim'
    const src = params.src as string | undefined

    if (!script || typeof script !== 'string') {
      throw new Error('Kit "python": "script" parameter is required')
    }

    const image = `python:${version}-${variant}`

    const cache = cacheMap[packageManager]
    if (!cache) {
      throw new Error(`Kit "python": unsupported packageManager "${packageManager}"`)
    }

    const parts: string[] = []

    if (install) {
      parts.push(buildInstallCommand(packageManager))
    }

    parts.push(`python /app/${script}`)

    const output: KitOutput = {
      image,
      cmd: ['sh', '-c', parts.join(' && ')],
      caches: [cache],
      allowNetwork: true
    }

    if (src) {
      output.mounts = [{host: src, container: '/app'}]
    }

    return output
  }
}
