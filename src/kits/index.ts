import type {Step} from '../types.js'
import {bashKit} from './builtin/bash.js'
import {nodeKit} from './builtin/node.js'
import {pythonKit} from './builtin/python.js'

export type KitOutput = Omit<Step, 'id' | 'name' | 'inputs' | 'outputPath' | 'timeoutSec' | 'allowFailure'>

export type Kit = {
  name: string;
  resolve(params: Record<string, unknown>): KitOutput;
}

const kits = new Map<string, Kit>([
  [bashKit.name, bashKit],
  [nodeKit.name, nodeKit],
  [pythonKit.name, pythonKit]
])

export function getKit(name: string): Kit {
  const kit = kits.get(name)
  if (!kit) {
    throw new Error(`Unknown kit: "${name}". Available kits: ${[...kits.keys()].join(', ')}`)
  }

  return kit
}
