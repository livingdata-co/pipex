import test from 'ava'
import {
  PipexError,
  DockerError,
  DockerNotAvailableError,
  ImagePullError,
  ContainerTimeoutError,
  ContainerCrashError,
  ContainerCleanupError,
  WorkspaceError,
  ArtifactNotFoundError,
  StagingError,
  PipelineError,
  ValidationError,
  CyclicDependencyError,
  StepNotFoundError,
  KitError,
  MissingParameterError
} from '../errors.js'

// -- instanceof chains -------------------------------------------------------

test('DockerNotAvailableError is instanceof DockerError and PipexError', t => {
  const error = new DockerNotAvailableError()
  t.true(error instanceof DockerNotAvailableError)
  t.true(error instanceof DockerError)
  t.true(error instanceof PipexError)
  t.true(error instanceof Error)
})

test('ImagePullError is instanceof DockerError and PipexError', t => {
  const error = new ImagePullError('alpine:latest')
  t.true(error instanceof ImagePullError)
  t.true(error instanceof DockerError)
  t.true(error instanceof PipexError)
})

test('ContainerTimeoutError is instanceof DockerError and PipexError', t => {
  const error = new ContainerTimeoutError(30)
  t.true(error instanceof ContainerTimeoutError)
  t.true(error instanceof DockerError)
  t.true(error instanceof PipexError)
})

test('ContainerCrashError is instanceof DockerError and PipexError', t => {
  const error = new ContainerCrashError('build', 1)
  t.true(error instanceof ContainerCrashError)
  t.true(error instanceof DockerError)
  t.true(error instanceof PipexError)
})

test('ContainerCleanupError is instanceof DockerError and PipexError', t => {
  const error = new ContainerCleanupError()
  t.true(error instanceof ContainerCleanupError)
  t.true(error instanceof DockerError)
  t.true(error instanceof PipexError)
})

test('ArtifactNotFoundError is instanceof WorkspaceError and PipexError', t => {
  const error = new ArtifactNotFoundError('missing artifact')
  t.true(error instanceof ArtifactNotFoundError)
  t.true(error instanceof WorkspaceError)
  t.true(error instanceof PipexError)
})

test('StagingError is instanceof WorkspaceError and PipexError', t => {
  const error = new StagingError('staging failed')
  t.true(error instanceof StagingError)
  t.true(error instanceof WorkspaceError)
  t.true(error instanceof PipexError)
})

test('ValidationError is instanceof PipelineError and PipexError', t => {
  const error = new ValidationError('invalid')
  t.true(error instanceof ValidationError)
  t.true(error instanceof PipelineError)
  t.true(error instanceof PipexError)
})

test('CyclicDependencyError is instanceof PipelineError and PipexError', t => {
  const error = new CyclicDependencyError('cycle detected')
  t.true(error instanceof CyclicDependencyError)
  t.true(error instanceof PipelineError)
  t.true(error instanceof PipexError)
})

test('StepNotFoundError is instanceof PipelineError and PipexError', t => {
  const error = new StepNotFoundError('build', 'compile')
  t.true(error instanceof StepNotFoundError)
  t.true(error instanceof PipelineError)
  t.true(error instanceof PipexError)
})

test('MissingParameterError is instanceof KitError and PipexError', t => {
  const error = new MissingParameterError('node', 'script')
  t.true(error instanceof MissingParameterError)
  t.true(error instanceof KitError)
  t.true(error instanceof PipexError)
})

// -- code property -----------------------------------------------------------

test('DockerNotAvailableError has code DOCKER_NOT_AVAILABLE', t => {
  t.is(new DockerNotAvailableError().code, 'DOCKER_NOT_AVAILABLE')
})

test('ImagePullError has code IMAGE_PULL_FAILED', t => {
  t.is(new ImagePullError('alpine').code, 'IMAGE_PULL_FAILED')
})

test('ContainerTimeoutError has code CONTAINER_TIMEOUT', t => {
  t.is(new ContainerTimeoutError(30).code, 'CONTAINER_TIMEOUT')
})

test('ContainerCrashError has code CONTAINER_CRASH', t => {
  t.is(new ContainerCrashError('build', 1).code, 'CONTAINER_CRASH')
})

test('ContainerCleanupError has code CONTAINER_CLEANUP_FAILED', t => {
  t.is(new ContainerCleanupError().code, 'CONTAINER_CLEANUP_FAILED')
})

test('ArtifactNotFoundError has code ARTIFACT_NOT_FOUND', t => {
  t.is(new ArtifactNotFoundError('msg').code, 'ARTIFACT_NOT_FOUND')
})

test('StagingError has code STAGING_FAILED', t => {
  t.is(new StagingError('msg').code, 'STAGING_FAILED')
})

test('ValidationError has code VALIDATION_ERROR', t => {
  t.is(new ValidationError('msg').code, 'VALIDATION_ERROR')
})

test('StepNotFoundError has code STEP_NOT_FOUND', t => {
  t.is(new StepNotFoundError('a', 'b').code, 'STEP_NOT_FOUND')
})

test('MissingParameterError has code MISSING_PARAMETER', t => {
  t.is(new MissingParameterError('node', 'script').code, 'MISSING_PARAMETER')
})

// -- transient flag ----------------------------------------------------------

test('DockerNotAvailableError is transient', t => {
  t.true(new DockerNotAvailableError().transient)
})

test('ImagePullError is transient', t => {
  t.true(new ImagePullError('alpine').transient)
})

test('ContainerTimeoutError is not transient', t => {
  t.false(new ContainerTimeoutError(30).transient)
})

test('ContainerCrashError is not transient', t => {
  t.false(new ContainerCrashError('build', 1).transient)
})

test('ValidationError is not transient', t => {
  t.false(new ValidationError('msg').transient)
})

test('StagingError is not transient', t => {
  t.false(new StagingError('msg').transient)
})

// -- cause chaining ----------------------------------------------------------

test('PipexError supports cause chaining', t => {
  const cause = new Error('original')
  const error = new ValidationError('wrapped', {cause})
  t.is(error.cause, cause)
})

test('DockerNotAvailableError supports cause chaining', t => {
  const cause = new Error('cannot connect')
  const error = new DockerNotAvailableError({cause})
  t.is(error.cause, cause)
})

test('ImagePullError supports cause chaining', t => {
  const cause = new Error('network error')
  const error = new ImagePullError('alpine', {cause})
  t.is(error.cause, cause)
})

// -- message content ---------------------------------------------------------

test('ContainerCrashError includes step id and exit code', t => {
  const error = new ContainerCrashError('build', 137)
  t.true(error.message.includes('build'))
  t.true(error.message.includes('137'))
  t.is(error.stepId, 'build')
  t.is(error.exitCode, 137)
})

test('StepNotFoundError includes step id and referenced step', t => {
  const error = new StepNotFoundError('deploy', 'build')
  t.true(error.message.includes('deploy'))
  t.true(error.message.includes('build'))
})

test('MissingParameterError includes kit name and param name', t => {
  const error = new MissingParameterError('node', 'script')
  t.true(error.message.includes('node'))
  t.true(error.message.includes('script'))
})

test('ContainerTimeoutError includes timeout value', t => {
  const error = new ContainerTimeoutError(60)
  t.true(error.message.includes('60'))
})

test('ImagePullError includes image name', t => {
  const error = new ImagePullError('myregistry/myimage:latest')
  t.true(error.message.includes('myregistry/myimage:latest'))
})
