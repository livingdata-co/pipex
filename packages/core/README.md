# @livingdata/pipex-core

Programmatic TypeScript API for the Pipex containerized pipeline engine.

Use this package to embed pipeline execution in your own tools, build custom orchestrators, or interact with workspaces and runs programmatically.

## Installation

```bash
npm install @livingdata/pipex-core
```

## Usage

```typescript
import {Pipex, DockerCliExecutor, ConsoleReporter} from '@livingdata/pipex-core'

// Built-in kits (shell, node, python) are always available
const pipex = new Pipex({
  runtime: new DockerCliExecutor(),
  reporter: new ConsoleReporter(),
  workdir: './workdir'
})

// Load from file or JS object
const pipeline = await pipex.load('./pipeline.yaml')
const pipeline = await pipex.load({
  id: 'my-pipeline',
  steps: [{id: 'greet', uses: 'shell', with: {run: 'echo hello'}}]
})

// Run the pipeline (all steps, or targeted)
await pipex.run(pipeline)
await pipex.run(pipeline, {target: ['greet']})

// Add custom kits
const pipex = new Pipex({
  workdir: './workdir',
  kits: [{
    name: 'rust',
    resolve: (params) => ({image: `rust:${params.version ?? '1'}`, cmd: ['cargo', 'run']})
  }]
})
```

## Main Exports

### Pipex Facade

- **`Pipex`** — Main entry point. Configure once, load pipelines from files or JS objects, run them. Built-in kits always available.

### Engine

- **`Workspace`** — Manages isolated execution environments (staging → commit lifecycle, artifact storage, caches)
- **`DockerCliExecutor`** — Runs containers via Docker CLI with mount configuration, log streaming, and two-phase execution
- **`ContainerExecutor`** — Abstract base class for pluggable container runtimes

### Orchestration

- **`PipelineRunner`** — DAG-based parallel step execution with fingerprint caching. Takes a `Pipeline` object.
- **`StepRunner`** — Single-step executor for interactive/exploratory workflows
- **`PipelineLoader`** — Constructor takes optional `KitContext`. Loads from file paths or JS objects (`PipelineDefinition`). Also provides `loadStep()`.
- **`StateManager`** — Persists step fingerprints and run IDs for cache hit detection
- **`CacheLockManager`** — In-memory async mutex for exclusive cache access during setup phases

### Built-in Kits

- **`defaultKits`** — Map of all built-in kits (shell, node, python)
- **`shellKit`**, **`nodeKit`**, **`pythonKit`** — Individual kit objects

### Kit Registry

- **`resolveKit(name, context?)`** — Resolves a kit by name: alias → local dir → local file → custom kits → built-in defaults → npm module
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
