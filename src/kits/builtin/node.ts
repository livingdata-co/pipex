import {KitError, MissingParameterError} from '../../errors.js'
import type {Kit, KitOutput} from '../index.js'

const cacheMap: Record<string, {name: string; path: string}> = {
  npm: {name: 'npm-cache', path: '/root/.npm'},
  pnpm: {name: 'pnpm-store', path: '/root/.local/share/pnpm/store'},
  yarn: {name: 'yarn-cache', path: '/usr/local/share/.cache/yarn'}
}

function buildInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case 'npm': {
      return 'cd /app && npm install --no-package-lock --no-audit --no-fund 2>&1'
    }

    case 'pnpm': {
      return 'cd /app && pnpm install --no-frozen-lockfile 2>&1'
    }

    case 'yarn': {
      return 'cd /app && yarn install 2>&1'
    }

    default: {
      throw new KitError('UNSUPPORTED_PACKAGE_MANAGER', `Kit "node": unsupported packageManager "${packageManager}"`)
    }
  }
}

export const nodeKit: Kit = {
  name: 'node',
  resolve(params) {
    const version = (params.version as string | undefined) ?? '24'
    const packageManager = (params.packageManager as string | undefined) ?? 'npm'
    const script = params.script as string | undefined
    const install = (params.install as boolean | undefined) ?? true
    const variant = (params.variant as string | undefined) ?? 'alpine'
    const src = params.src as string | undefined

    if (!script || typeof script !== 'string') {
      throw new MissingParameterError('node', 'script')
    }

    const image = `node:${version}-${variant}`

    const parts: string[] = []

    if (install) {
      parts.push(buildInstallCommand(packageManager))
    }

    parts.push(`node /app/${script}`)

    const cache = cacheMap[packageManager]
    if (!cache) {
      throw new KitError('UNSUPPORTED_PACKAGE_MANAGER', `Kit "node": unsupported packageManager "${packageManager}"`)
    }

    const output: KitOutput = {
      image,
      cmd: ['sh', '-c', parts.join(' && ')],
      caches: [cache],
      allowNetwork: true
    }

    if (src) {
      output.sources = [{host: src, container: '/app'}]
    }

    return output
  }
}
