import {ValidationError} from '../errors.js'
import {getKit} from '../kits/index.js'
import {isKitStep, type CacheSpec, type KitStepDefinition, type MountSpec, type Step, type StepDefinition} from '../types.js'
import {slugify, mergeEnv, mergeCaches, mergeMounts} from './pipeline-loader.js'

/**
 * Resolves a step definition into a fully resolved Step.
 * Kit steps (`uses`) are expanded into image + cmd.
 */
export function resolveStep(step: StepDefinition): Step {
  if (!step.id && !step.name) {
    throw new ValidationError('Invalid step: at least one of "id" or "name" must be defined')
  }

  const id = step.id ?? slugify(step.name!)
  const {name} = step

  if (!isKitStep(step)) {
    return {...step, id, name}
  }

  return resolveKitStep(step, id, name)
}

function resolveKitStep(step: KitStepDefinition, id: string, name: string | undefined): Step {
  const kit = getKit(step.uses)
  const kitOutput = kit.resolve(step.with ?? {})

  return {
    id,
    name,
    image: kitOutput.image,
    cmd: kitOutput.cmd,
    env: mergeEnv(kitOutput.env, step.env),
    inputs: step.inputs,
    outputPath: step.outputPath,
    caches: mergeCaches(kitOutput.caches, step.caches),
    mounts: mergeMounts(kitOutput.mounts, step.mounts),
    sources: mergeMounts(kitOutput.sources, step.sources),
    timeoutSec: step.timeoutSec,
    allowFailure: step.allowFailure,
    allowNetwork: step.allowNetwork ?? kitOutput.allowNetwork,
    retries: step.retries,
    retryDelayMs: step.retryDelayMs
  }
}

/**
 * Validates a resolved step for correctness and security.
 */
export function validateStep(step: Step): void {
  validateIdentifier(step.id, 'step id')

  if (!step.image || typeof step.image !== 'string') {
    throw new ValidationError(`Invalid step ${step.id}: image is required`)
  }

  if (!Array.isArray(step.cmd) || step.cmd.length === 0) {
    throw new ValidationError(`Invalid step ${step.id}: cmd must be a non-empty array`)
  }

  if (step.inputs) {
    for (const input of step.inputs) {
      validateIdentifier(input.step, `input step name in step ${step.id}`)
    }
  }

  if (step.mounts) {
    validateMounts(step.id, step.mounts)
  }

  if (step.sources) {
    validateMounts(step.id, step.sources)
  }

  if (step.caches) {
    validateCaches(step.id, step.caches)
  }
}

function validateIdentifier(id: string, context: string): void {
  if (!/^[\w-]+$/.test(id)) {
    throw new ValidationError(`Invalid ${context}: '${id}' must contain only alphanumeric characters, underscore, and hyphen`)
  }

  if (id.includes('..')) {
    throw new ValidationError(`Invalid ${context}: '${id}' cannot contain '..'`)
  }
}

function validateMounts(stepId: string, mounts: MountSpec[]): void {
  for (const mount of mounts) {
    if (!mount.host || typeof mount.host !== 'string') {
      throw new ValidationError(`Step ${stepId}: mount.host is required and must be a string`)
    }

    if (mount.host.startsWith('/')) {
      throw new ValidationError(`Step ${stepId}: mount.host '${mount.host}' must be a relative path`)
    }

    if (mount.host.includes('..')) {
      throw new ValidationError(`Step ${stepId}: mount.host '${mount.host}' must not contain '..'`)
    }

    if (!mount.container || typeof mount.container !== 'string') {
      throw new ValidationError(`Step ${stepId}: mount.container is required and must be a string`)
    }

    if (!mount.container.startsWith('/')) {
      throw new ValidationError(`Step ${stepId}: mount.container '${mount.container}' must be an absolute path`)
    }

    if (mount.container.includes('..')) {
      throw new ValidationError(`Step ${stepId}: mount.container '${mount.container}' must not contain '..'`)
    }
  }
}

function validateCaches(stepId: string, caches: CacheSpec[]): void {
  for (const cache of caches) {
    if (!cache.name || typeof cache.name !== 'string') {
      throw new ValidationError(`Step ${stepId}: cache.name is required and must be a string`)
    }

    validateIdentifier(cache.name, `cache name in step ${stepId}`)

    if (!cache.path || typeof cache.path !== 'string') {
      throw new ValidationError(`Step ${stepId}: cache.path is required and must be a string`)
    }

    if (!cache.path.startsWith('/')) {
      throw new ValidationError(`Step ${stepId}: cache.path '${cache.path}' must be an absolute path`)
    }
  }
}
