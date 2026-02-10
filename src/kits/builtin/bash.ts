import type {Kit, KitOutput} from '../index.js'

export const bashKit: Kit = {
  name: 'bash',
  resolve(params) {
    const run = params.run as string | undefined
    if (!run || typeof run !== 'string') {
      throw new Error('Kit "bash": "run" parameter is required')
    }

    const image = (params.image as string | undefined) ?? 'alpine:3.20'
    const src = params.src as string | undefined

    const output: KitOutput = {
      image,
      cmd: ['sh', '-c', run]
    }

    if (src) {
      output.mounts = [{host: src, container: '/app'}]
    }

    return output
  }
}
