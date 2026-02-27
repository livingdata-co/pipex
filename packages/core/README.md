# @livingdata/pipex-core

Programmatic TypeScript API for the Pipex containerized pipeline engine.

Use this package to embed pipeline execution in your own tools, build custom orchestrators, or interact with workspaces and runs programmatically.

## Installation

```bash
npm install @livingdata/pipex-core
```

## Usage

```typescript
import {
  PipelineRunner,
  PipelineLoader,
  Workspace,
  DockerCliExecutor,
  ConsoleReporter,
  resolveKit,
  type KitContext
} from '@livingdata/pipex-core'

// Load and validate a pipeline
const loader = new PipelineLoader()
const pipeline = await loader.load('./pipeline.yaml', kitContext)

// Create workspace and executor
const workspace = await Workspace.create('./workdir', 'my-pipeline')
const executor = new DockerCliExecutor()
const reporter = new ConsoleReporter()

// Run the pipeline
const runner = new PipelineRunner({workspace, executor, reporter})
await runner.run(pipeline)
```

## Main Exports

### Engine

- **`Workspace`** — Manages isolated execution environments (staging → commit lifecycle, artifact storage, caches)
- **`DockerCliExecutor`** — Runs containers via Docker CLI with mount configuration, log streaming, and two-phase execution
- **`ContainerExecutor`** — Abstract base class for pluggable container runtimes

### Orchestration

- **`PipelineRunner`** — DAG-based parallel step execution with fingerprint caching
- **`StepRunner`** — Single-step executor for interactive/exploratory workflows
- **`PipelineLoader`** — Validates pipeline YAML/JSON configs, resolves kit steps
- **`StateManager`** — Persists step fingerprints and run IDs for cache hit detection
- **`CacheLockManager`** — In-memory async mutex for exclusive cache access during setup phases

### Kit Registry

- **`resolveKit(name, context)`** — Resolves a kit by name: builtins, local files/dirs, aliases, or npm modules
- **`loadExternalKit(specifier, cwd)`** — Loads a kit from a file path or npm specifier

### DAG Utilities

- **`buildGraph`**, **`validateGraph`**, **`topologicalLevels`**, **`subgraph`**, **`leafNodes`**

### Reporting

- **`ConsoleReporter`** — Structured JSON output via Pino
- **`StreamReporter`**, **`CompositeReporter`** — Composable event-based reporters
- **`EventAggregator`** — Aggregates pipeline events into session state

### Types

All domain types are exported: `Pipeline`, `Step`, `Kit`, `KitContext`, `KitOutput`, `StepDefinition`, `PipelineDefinition`, `PipexConfig`, etc.

### Errors

Structured error hierarchy: `PipexError` → `DockerError`, `WorkspaceError`, `PipelineError`, `KitError` with specific subclasses.
