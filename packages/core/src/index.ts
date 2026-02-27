// Engine layer
export {Workspace} from './engine/workspace.js'
export {ContainerExecutor, type LogLine, type OnLogLine} from './engine/executor.js'
export {DockerCliExecutor} from './engine/docker-executor.js'
export type {BindMount, InputMount, OutputMount, CacheMount, SetupPhase, RunContainerRequest, RunContainerResult} from './engine/types.js'

// Pipex facade
export {Pipex, type PipexOptions} from './pipex.js'
export {PipexWorkspace, type WorkspaceInfo, type StepInfo, type RunMeta, type ArtifactEntry} from './pipex-workspace.js'

// Pipeline orchestration
export {PipelineRunner} from './pipeline-runner.js'
export {StepRunner, type StepRunResult} from './step-runner.js'
export {PipelineLoader, slugify, parsePipelineFile, mergeEnv, mergeCaches, mergeMounts, mergeSetup} from './pipeline-loader.js'
export {resolveStep, validateStep} from './step-resolver.js'
export {StateManager} from './state.js'
export {CacheLockManager} from './cache-lock.js'

// Kit registry
export {resolveKit, loadExternalKit} from './kit-registry.js'

// Built-in kits
export {defaultKits, nodeKit, pythonKit, shellKit} from './kits/index.js'

// DAG utilities
export {buildGraph, validateGraph, topologicalLevels, subgraph, leafNodes} from './dag.js'
export type {StepGraph} from './dag.js'

// Condition evaluation
export {evaluateCondition} from './condition.js'

// Env file loading
export {loadEnvFile} from './env-file.js'

// Reporting
export {ConsoleReporter} from './reporter.js'
export type {
  Reporter,
  StepRef,
  JobContext,
  PipelineEvent,
  PipelineStartEvent,
  StepStartingEvent,
  StepSkippedEvent,
  StepFinishedEvent,
  StepFailedEvent,
  StepRetryingEvent,
  StepWouldRunEvent,
  StepLogEvent,
  PipelineFinishedEvent,
  PipelineFailedEvent
} from './reporter.js'
export {StreamReporter, CompositeReporter} from './stream-reporter.js'
export {InMemoryTransport} from './transport.js'
export type {TransportMessage, EventTransport} from './transport.js'
export {EventAggregator} from './event-aggregator.js'
export type {SessionState, StepState} from './event-aggregator.js'

// Bundle
export {collectDependencies, buildIgnoreFilter, buildBundle, extractBundle} from './bundle.js'

// Utilities
export {dirSize, resolveHostPath, formatSize, formatDuration} from './utils.js'

// Domain types
export {isKitStep} from './types.js'
export type {
  MountSpec,
  InputSpec,
  CacheSpec,
  SetupSpec,
  Step,
  Pipeline,
  KitStepDefinition,
  RawStepDefinition,
  StepDefinition,
  PipelineDefinition,
  PipexConfig,
  Kit,
  KitOutput,
  KitResolveContext,
  KitContext
} from './types.js'

// Errors
export {
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
  BundleError,
  KitError,
  MissingParameterError
} from './errors.js'
