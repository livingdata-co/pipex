import {MissingParameterError} from '../../errors.js'
import type {Kit, KitOutput} from '../index.js'

export const shellKit: Kit = {
  name: 'shell',
  resolve(params) {
    const run = params.run as string | undefined
    if (!run || typeof run !== 'string') {
      throw new MissingParameterError('shell', 'run')
    }

    const packages = params.packages as string[] | undefined
    const hasPackages = packages && packages.length > 0
    const src = params.src as string | undefined

    const defaultImage = hasPackages ? 'debian:bookworm-slim' : 'alpine:3.20'
    const image = (params.image as string | undefined) ?? defaultImage

    const output: KitOutput = {
      image,
      cmd: ['sh', '-c', run]
    }

    if (hasPackages) {
      output.setup = {
        cmd: ['sh', '-c', `apt-get update && apt-get install -y --no-install-recommends ${packages.join(' ')} && rm -rf /var/lib/apt/lists/*`],
        caches: [{name: 'apt-cache', path: '/var/cache/apt', exclusive: true}],
        allowNetwork: true
      }
    }

    if (src) {
      output.mounts = [{host: src, container: '/app'}]
    }

    return output
  }
}
