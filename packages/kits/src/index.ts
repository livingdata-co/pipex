import type {Kit} from '@livingdata/pipex-core'
import {nodeKit} from './node.js'
import {pythonKit} from './python.js'
import {shellKit} from './shell.js'

export {nodeKit} from './node.js'
export {pythonKit} from './python.js'
export {shellKit} from './shell.js'

export const builtinKits = new Map<string, Kit>([
  [nodeKit.name, nodeKit],
  [pythonKit.name, pythonKit],
  [shellKit.name, shellKit]
])
