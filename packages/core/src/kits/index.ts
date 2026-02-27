import type {Kit} from '../types.js'
import {nodeKit} from './node.js'
import {pythonKit} from './python.js'
import {shellKit} from './shell.js'

export {nodeKit} from './node.js'
export {pythonKit} from './python.js'
export {shellKit} from './shell.js'

export const defaultKits = new Map<string, Kit>([
  [nodeKit.name, nodeKit],
  [pythonKit.name, pythonKit],
  [shellKit.name, shellKit]
])
