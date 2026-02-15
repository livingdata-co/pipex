/**
 * Engine layer exports for programmatic use.
 *
 * The engine provides low-level primitives for container execution
 * and artifact management, decoupled from pipeline orchestration.
 *
 * For CLI usage, see src/cli/index.ts
 *
 * @example
 * ```typescript
 * import {Workspace, DockerCliExecutor} from '@livingdata/pipex'
 *
 * const ws = await Workspace.create('/tmp/workdir', 'my-workspace')
 * const executor = new DockerCliExecutor()
 * await executor.check()
 *
 * // Prepare cache
 * await ws.prepareCache('pnpm-store')
 *
 * const artifactId = ws.generateArtifactId()
 * await ws.prepareArtifact(artifactId)
 *
 * await executor.run(ws, {
 *   name: 'my-container',
 *   image: 'node:20-alpine',
 *   cmd: ['pnpm', 'install'],
 *   inputs: [],
 *   output: {stagingArtifactId: artifactId, containerPath: '/output'},
 *   caches: [{
 *     name: 'pnpm-store',
 *     containerPath: '/root/.local/share/pnpm/store'
 *   }],
 *   network: 'none'
 * }, (log) => console.log(log))
 *
 * await ws.commitArtifact(artifactId)
 * ```
 */

// Export engine layer for programmatic use
export {
  Workspace,
  ContainerExecutor,
  DockerCliExecutor,
  type InputMount,
  type OutputMount,
  type CacheMount,
  type RunContainerRequest,
  type RunContainerResult,
  type LogLine,
  type OnLogLine
} from './engine/index.js'

// Export core layer for pipeline orchestration
export {
  PipelineRunner,
  StepRunner,
  PipelineLoader,
  StateManager,
  ConsoleReporter,
  StreamReporter,
  CompositeReporter,
  InMemoryTransport,
  EventAggregator,
  type Reporter,
  type StepRef,
  type JobContext,
  type PipelineEvent,
  type StepLogEvent,
  type TransportMessage,
  type EventTransport,
  type SessionState,
  type StepState,
  type StepGraph,
  buildGraph,
  topologicalLevels,
  subgraph,
  leafNodes,
  evaluateCondition,
  dirSize,
  formatSize,
  formatDuration
} from './core/index.js'

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
  KitError,
  MissingParameterError
} from './errors.js'
