import {readFile} from 'node:fs/promises'
import type {PipelineConfig, StepConfig} from './types.js'

export class PipelineLoader {
  async load(filePath: string): Promise<PipelineConfig> {
    const content = await readFile(filePath, 'utf8')
    const config = JSON.parse(content) as PipelineConfig

    if (!Array.isArray(config.steps) || config.steps.length === 0) {
      throw new Error('Invalid pipeline: steps must be a non-empty array')
    }

    for (const step of config.steps) {
      this.validateStep(step)
    }

    return config
  }

  private validateStep(step: StepConfig): void {
    if (!step.id || typeof step.id !== 'string') {
      throw new Error('Invalid step: id is required')
    }

    this.validateIdentifier(step.id, 'step id')

    if (!step.image || typeof step.image !== 'string') {
      throw new Error(`Invalid step ${step.id}: image is required`)
    }

    if (!Array.isArray(step.cmd) || step.cmd.length === 0) {
      throw new Error(`Invalid step ${step.id}: cmd must be a non-empty array`)
    }

    if (step.inputs) {
      for (const input of step.inputs) {
        this.validateIdentifier(input.step, `input step name in step ${step.id}`)
      }
    }

    if (step.mounts) {
      this.validateMounts(step.id, step.mounts)
    }

    if (step.caches) {
      this.validateCaches(step.id, step.caches)
    }
  }

  private validateMounts(stepId: string, mounts: unknown): void {
    if (!Array.isArray(mounts)) {
      throw new TypeError(`Step ${stepId}: mounts must be an array`)
    }

    for (const mount of mounts as Array<{host: string; container: string}>) {
      if (!mount.host || typeof mount.host !== 'string') {
        throw new Error(`Step ${stepId}: mount.host is required and must be a string`)
      }

      if (mount.host.startsWith('/')) {
        throw new Error(`Step ${stepId}: mount.host '${mount.host}' must be a relative path`)
      }

      if (mount.host.includes('..')) {
        throw new Error(`Step ${stepId}: mount.host '${mount.host}' must not contain '..'`)
      }

      if (!mount.container || typeof mount.container !== 'string') {
        throw new Error(`Step ${stepId}: mount.container is required and must be a string`)
      }

      if (!mount.container.startsWith('/')) {
        throw new Error(`Step ${stepId}: mount.container '${mount.container}' must be an absolute path`)
      }

      if (mount.container.includes('..')) {
        throw new Error(`Step ${stepId}: mount.container '${mount.container}' must not contain '..'`)
      }
    }
  }

  private validateCaches(stepId: string, caches: unknown): void {
    if (!Array.isArray(caches)) {
      throw new TypeError(`Step ${stepId}: caches must be an array`)
    }

    for (const cache of caches as Array<{name: string; path: string}>) {
      if (!cache.name || typeof cache.name !== 'string') {
        throw new Error(`Step ${stepId}: cache.name is required and must be a string`)
      }

      this.validateIdentifier(cache.name, `cache name in step ${stepId}`)

      if (!cache.path || typeof cache.path !== 'string') {
        throw new Error(`Step ${stepId}: cache.path is required and must be a string`)
      }

      if (!cache.path.startsWith('/')) {
        throw new Error(`Step ${stepId}: cache.path '${cache.path}' must be an absolute path`)
      }
    }
  }

  private validateIdentifier(id: string, context: string): void {
    if (!/^[\w-]+$/.test(id)) {
      throw new Error(`Invalid ${context}: '${id}' must contain only alphanumeric characters, underscore, and hyphen`)
    }

    if (id.includes('..')) {
      throw new Error(`Invalid ${context}: '${id}' cannot contain '..'`)
    }
  }
}
