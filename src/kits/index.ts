import {KitError} from '../errors.js'
import type {Step} from '../types.js'
import {nodeKit} from './builtin/node.js'
import {pythonKit} from './builtin/python.js'
import {shellKit} from './builtin/shell.js'

export type KitOutput = Omit<Step, 'id' | 'name' | 'inputs' | 'outputPath' | 'timeoutSec' | 'allowFailure'>

export type Kit = {
  name: string;
  resolve(params: Record<string, unknown>): KitOutput;
}

const kits = new Map<string, Kit>([
  [nodeKit.name, nodeKit],
  [pythonKit.name, pythonKit],
  [shellKit.name, shellKit]
])

export function getKit(name: string): Kit {
  const kit = kits.get(name)
  if (!kit) {
    throw new KitError('UNKNOWN_KIT', `Unknown kit: "${name}". Available kits: ${[...kits.keys()].join(', ')}`)
  }

  return kit
}
