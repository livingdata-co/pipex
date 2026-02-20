import {KitError, MissingParameterError} from '../../errors.js'
import type {Kit, KitOutput} from '../index.js'

const cacheMap: Record<string, {name: string; path: string}> = {
  pip: {name: 'pip-cache', path: '/root/.cache/pip'},
  uv: {name: 'uv-cache', path: '/root/.cache/uv'}
}

function buildInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case 'pip': {
      return 'pip install --quiet --root-user-action=ignore -r /app/requirements.txt 2>&1'
    }

    case 'uv': {
      return 'uv pip install --quiet -r /app/requirements.txt 2>&1'
    }

    default: {
      throw new KitError('UNSUPPORTED_PACKAGE_MANAGER', `Kit "python": unsupported packageManager "${packageManager}"`)
    }
  }
}

export const pythonKit: Kit = {
  name: 'python',
  resolve(params) {
    const version = (params.version as string | undefined) ?? '3.12'
    const packageManager = (params.packageManager as string | undefined) ?? 'pip'
    const script = params.script as string | undefined
    const run = params.run as string | undefined
    const install = (params.install as boolean | undefined) ?? true
    const variant = (params.variant as string | undefined) ?? 'slim'
    const src = params.src as string | undefined

    if (script && run) {
      throw new KitError('CONFLICTING_PARAMETERS', 'Kit "python": "script" and "run" are mutually exclusive')
    }

    if (!script && !run) {
      throw new MissingParameterError('python', 'script" or "run')
    }

    const image = `python:${version}-${variant}`

    const cache = cacheMap[packageManager]
    if (!cache) {
      throw new KitError('UNSUPPORTED_PACKAGE_MANAGER', `Kit "python": unsupported packageManager "${packageManager}"`)
    }

    const output: KitOutput = {
      image,
      cmd: ['sh', '-c', run ?? `python /app/${script!}`]
    }

    if (install) {
      output.setup = {
        cmd: ['sh', '-c', buildInstallCommand(packageManager)],
        caches: [{...cache, exclusive: true}],
        allowNetwork: true
      }
    }

    if (src) {
      output.mounts = [{host: src, container: '/app'}]
    }

    return output
  }
}
