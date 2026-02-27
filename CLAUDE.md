# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pipex is a containerized pipeline execution engine that runs multi-step pipelines where each step executes in an isolated Docker container. It manages runs (artifacts + logs + metadata), caches, and dependencies between steps with fingerprint-based caching.

## Commands

```bash
pipex run [pipeline]                                    # Run pipeline (file, directory, or cwd)
pipex show <workspace>                                  # Show steps and runs in a workspace
pipex logs <workspace> <step>                           # Show logs from last run of a step
pipex inspect <workspace> <step>                        # Show run metadata
pipex prune <workspace>                                 # Remove old runs, keep current
pipex list                                             # List workspaces
pipex rm <workspace>                                   # Remove workspace
pipex clean                                            # Remove all workspaces
npm run cli -- run [pipeline]                          # Run pipeline (dev mode via tsx)
npm run build                                          # Compile TypeScript (tsc → dist/)
npm test                                               # Run unit tests with AVA
npm run lint                                           # Lint with XO
npm run lint:fix                                       # Auto-fix lint issues
```

## Architecture

Monorepo with npm workspaces. Two packages: `packages/core`, `packages/cli`.

### Core (`packages/core/`) — `@livingdata/pipex-core`

Programmatic TypeScript API. No CLI dependency. Includes built-in kits (shell, node, python).

#### Pipex Facade (`packages/core/src/pipex.ts`)
- **Pipex** — Main entry point for programmatic usage. Wraps `PipelineLoader`, `PipelineRunner`, and `StepRunner`. Configure once with runtime, reporter, workdir, and custom kits. Built-in kits (shell, node, python) are always available. Provides `load()` (from file or JS object), `loadStep()`, and `run()` methods.

#### Engine (`packages/core/src/engine/`)
- **workspace.ts** — Manages isolated execution environments with three directory types: `staging/` (temporary write), `runs/` (committed immutable run outputs), `caches/` (persistent read-write shared across steps). Two-phase run lifecycle: prepareRun → commitRun/discardRun. Each run contains `artifacts/`, `stdout.log`, `stderr.log`, and `meta.json`.
- **docker-executor.ts** — Implements `ContainerExecutor` abstract class using Docker CLI via `execa`. Two execution paths: **simple** (`docker create` + `docker cp` + `docker start -a`) for steps without setup, and **two-phase** (`docker create --entrypoint sleep` + `docker start` + `docker exec` setup + optional `docker network disconnect` + `docker exec` run) for steps with a setup phase. Handles mount configuration (inputs=read-only, output=read-write, caches=read-write, host mounts=read-only, sources=copied into container layer), environment isolation (only PATH/HOME/DOCKER_* forwarded), log streaming via `subprocess.iterable()`, and container cleanup.
- **executor.ts** — Abstract `ContainerExecutor` base class for pluggable runtimes. The `run()` method accepts an optional `onSetupComplete` callback for releasing cache locks after the setup phase.

#### Orchestration (`packages/core/src/`)
- **pipeline-runner.ts** — Orchestrates DAG-based parallel step execution. Takes a `Pipeline` object (already loaded). Computes SHA256 fingerprints (image + cmd + setup.cmd + env + sorted inputs + mounts) for cache invalidation. Each step execution produces a **run** with artifacts, captured logs (stdout.log/stderr.log), and structured metadata (meta.json). Mounts previous run artifacts as inputs. Supports `allowFailure` and `force` (skip cache) options.
- **step-runner.ts** — Standalone single-step executor (used by `exec` command). Same caching and execution logic as pipeline-runner but for individual steps.
- **state.ts** — Persists step fingerprints and run IDs to `state.json` per workspace. Handles cache hit detection and invalidation propagation through dependent steps.
- **pipeline-loader.ts** — Constructor takes optional `KitContext`. Loads pipelines from file paths or JS objects (`PipelineDefinition`). Also provides `loadStep()` for single step files. Validates pipeline YAML/JSON configs with security checks (relative host mounts only — `..` allowed but bounded to `process.cwd()` at runtime, absolute container paths, alphanumeric IDs). Provides merge helpers: `mergeEnv`, `mergeCaches`, `mergeMounts`, `mergeSetup`.
- **cache-lock.ts** — In-memory async mutex (`CacheLockManager`) for exclusive cache access during setup phases. Locks are acquired in sorted order to prevent deadlocks and released via `onSetupComplete` callback.
- **kit-registry.ts** — Kit resolution logic (`resolveKit`, `loadExternalKit`). Resolution order: alias → local dir → local file → custom kits (from context) → built-in `defaultKits` (always available) → npm module.
- **reporter.ts** — `ConsoleReporter` implementation (structured JSON via Pino).

#### Built-in Kits (`packages/core/src/kits/`)
- **shell.ts** — General-purpose shell command runner. Without `packages`: alpine, no network, no setup. With `packages`: debian image, setup phase runs `apt-get install` with exclusive `apt-cache` and network access, run phase executes the user command.
- **node.ts** — Node.js script runner. When `install` is true (default), setup phase runs npm/pnpm/yarn install with exclusive package manager cache and network access, run phase executes the script/command.
- **python.ts** — Python script runner. When `install` is true (default), setup phase runs pip/uv install with exclusive package manager cache and network access, run phase executes the script/command.
- **index.ts** — Exports `defaultKits` map and individual kit objects (`nodeKit`, `pythonKit`, `shellKit`).

Kits use a **two-phase execution model**: the `setup` phase handles dependency installation (with exclusive cache locking and network access), and the `cmd` phase runs the actual command (parallel-safe, isolated). This prevents cache corruption when multiple steps share a package manager cache.

Kit resolution happens in `resolveKitStep()` (`packages/core/src/step-resolver.ts`): `uses` selects the kit, `with` passes parameters, and user-level `env`/`caches`/`mounts`/`sources`/`setup` merge with kit defaults (user values win). The `node` kit uses `sources` (not `mounts`) for `src` so that `node_modules` can be created alongside source files in the container's writable layer.

#### Types and Errors (`packages/core/src/`)
- **types.ts** — All domain types including `Kit`, `KitOutput`, `KitContext`, `KitResolveContext`, `Step`, `Pipeline` (with `root`), `PipexConfig`.
- **errors.ts** — Structured error hierarchy: `PipexError` → `DockerError`, `WorkspaceError`, `PipelineError`, `KitError`.

### CLI (`packages/cli/`) — `@livingdata/pipex`

CLI entry point and interactive reporter. Dependency: core.

- **commands/** — Commander.js command handlers (`run`, `exec`, `show`, `logs`, `inspect`, `export`, `cat`, `list`, `prune`, `rm`, `rm-step`, `clean`). Uses `Pipex` facade from core.
- **interactive-reporter.ts** — `InteractiveReporter` (colored spinners via chalk/log-update).
- **index.ts** — CLI entry point using Commander.js.

### Execution Flow
```
CLI → Pipex.load() → PipelineLoader.load() → Pipeline
   → Pipex.run(pipeline) → PipelineRunner.run(pipeline) → Workspace.create()
     → For each step: fingerprint check → acquire cache locks → prepareRun
       → DockerCliExecutor.run() (setup phase → release locks → run phase, with log capture)
       → write meta.json → commitRun/discardRun → update state
```

## Code Style

- ESM modules (NodeNext), target ES2024, strict TypeScript
- XO linter: no semicolons, 2-space indent
- `@typescript-eslint/naming-convention` is disabled
- `no-await-in-loop` is disabled (sequential step execution is intentional)
