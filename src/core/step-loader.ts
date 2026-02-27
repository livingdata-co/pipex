import {readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {ValidationError} from '../errors.js'
import type {KitContext} from '../kits/index.js'
import type {StepDefinition, Step} from '../types.js'
import {parsePipelineFile} from './pipeline-loader.js'
import {resolveStep, validateStep} from './step-resolver.js'

/**
 * Loads and resolves a single step definition from a file.
 */
export async function loadStepFile(filePath: string, stepIdOverride?: string, context?: KitContext): Promise<Step> {
  const content = await readFile(filePath, 'utf8')
  const raw = parsePipelineFile(content, filePath) as StepDefinition

  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('Step file must contain an object')
  }

  // If no id/name provided, require --step override
  if (!('id' in raw && raw.id) && !('name' in raw && raw.name) && !stepIdOverride) {
    throw new ValidationError('Step file must have "id" or "name", or use --step to set an ID')
  }

  // Apply step ID override
  if (stepIdOverride) {
    (raw as Record<string, unknown>).id = stepIdOverride
  }

  const pipelineRoot = dirname(resolve(filePath))
  const step = await resolveStep(raw, context, pipelineRoot)
  validateStep(step)
  return step
}
