export class PipexError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: {cause?: unknown}
  ) {
    super(message, options)
    this.name = 'PipexError'
  }

  get transient(): boolean {
    return false
  }
}

// -- Docker errors -----------------------------------------------------------

export class DockerError extends PipexError {
  constructor(code: string, message: string, options?: {cause?: unknown}) {
    super(code, message, options)
    this.name = 'DockerError'
  }
}

export class DockerNotAvailableError extends DockerError {
  constructor(options?: {cause?: unknown}) {
    super('DOCKER_NOT_AVAILABLE', 'Docker CLI not found. Please install Docker.', options)
    this.name = 'DockerNotAvailableError'
  }

  override get transient(): boolean {
    return true
  }
}

export class ImagePullError extends DockerError {
  constructor(image: string, options?: {cause?: unknown}) {
    super('IMAGE_PULL_FAILED', `Failed to pull image "${image}"`, options)
    this.name = 'ImagePullError'
  }

  override get transient(): boolean {
    return true
  }
}

export class ContainerTimeoutError extends DockerError {
  constructor(timeoutSec: number, options?: {cause?: unknown}) {
    super('CONTAINER_TIMEOUT', `Container exceeded timeout of ${timeoutSec}s`, options)
    this.name = 'ContainerTimeoutError'
  }
}

export class ContainerCrashError extends DockerError {
  constructor(
    readonly stepId: string,
    readonly exitCode: number,
    options?: {cause?: unknown}
  ) {
    super('CONTAINER_CRASH', `Step ${stepId} failed with exit code ${exitCode}`, options)
    this.name = 'ContainerCrashError'
  }
}

export class ContainerCleanupError extends DockerError {
  constructor(options?: {cause?: unknown}) {
    super('CONTAINER_CLEANUP_FAILED', 'Failed to clean up container', options)
    this.name = 'ContainerCleanupError'
  }
}

// -- Workspace errors --------------------------------------------------------

export class WorkspaceError extends PipexError {
  constructor(code: string, message: string, options?: {cause?: unknown}) {
    super(code, message, options)
    this.name = 'WorkspaceError'
  }
}

export class ArtifactNotFoundError extends WorkspaceError {
  constructor(message: string, options?: {cause?: unknown}) {
    super('ARTIFACT_NOT_FOUND', message, options)
    this.name = 'ArtifactNotFoundError'
  }
}

export class StagingError extends WorkspaceError {
  constructor(message: string, options?: {cause?: unknown}) {
    super('STAGING_FAILED', message, options)
    this.name = 'StagingError'
  }
}

// -- Pipeline errors ---------------------------------------------------------

export class PipelineError extends PipexError {
  constructor(code: string, message: string, options?: {cause?: unknown}) {
    super(code, message, options)
    this.name = 'PipelineError'
  }
}

export class ValidationError extends PipelineError {
  constructor(message: string, options?: {cause?: unknown}) {
    super('VALIDATION_ERROR', message, options)
    this.name = 'ValidationError'
  }
}

export class CyclicDependencyError extends PipelineError {
  constructor(message: string, options?: {cause?: unknown}) {
    super('CYCLIC_DEPENDENCY', message, options)
    this.name = 'CyclicDependencyError'
  }
}

export class StepNotFoundError extends PipelineError {
  constructor(stepId: string, referencedStep: string, options?: {cause?: unknown}) {
    super('STEP_NOT_FOUND', `Step ${stepId}: input step '${referencedStep}' not found or not yet executed`, options)
    this.name = 'StepNotFoundError'
  }
}

// -- Kit errors --------------------------------------------------------------

export class KitError extends PipexError {
  constructor(code: string, message: string, options?: {cause?: unknown}) {
    super(code, message, options)
    this.name = 'KitError'
  }
}

export class MissingParameterError extends KitError {
  constructor(kitName: string, paramName: string, options?: {cause?: unknown}) {
    super('MISSING_PARAMETER', `Kit "${kitName}": "${paramName}" parameter is required`, options)
    this.name = 'MissingParameterError'
  }
}
