# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pipex is a containerized pipeline execution engine that runs multi-step pipelines where each step executes in an isolated Docker container. It manages runs (artifacts + logs + metadata), caches, and dependencies between steps with fingerprint-based caching.

## Commands

```bash
pipex run <pipeline.yaml>                               # Run pipeline (published binary)
pipex show <workspace>                                  # Show steps and runs in a workspace
pipex logs <workspace> <step>                           # Show logs from last run of a step
pipex inspect <workspace> <step>                        # Show run metadata
pipex list                                             # List workspaces
pipex rm <workspace>                                   # Remove workspace
pipex clean                                            # Remove all workspaces
npm run cli -- run <pipeline.yaml>                     # Run pipeline (dev mode via tsx)
npm run build                                          # Compile TypeScript (tsc → dist/)
npm test                                               # Run unit tests with AVA
npm run lint                                           # Lint with XO
npm run lint:fix                                       # Auto-fix lint issues
```

## Architecture

Two-layer design:

### Engine Layer (`src/engine/`) — Low-level container execution
- **workspace.ts** — Manages isolated execution environments with three directory types: `staging/` (temporary write), `runs/` (committed immutable run outputs), `caches/` (persistent read-write shared across steps). Two-phase run lifecycle: prepareRun → commitRun/discardRun. Each run contains `artifacts/`, `stdout.log`, `stderr.log`, and `meta.json`.
- **docker-executor.ts** — Implements `ContainerExecutor` abstract class using Docker CLI via `execa`. Uses `docker create` + `docker cp` + `docker start` lifecycle. Handles mount configuration (inputs=read-only, output=read-write, caches=read-write, host mounts=read-only, sources=copied into container layer), environment isolation (only PATH/HOME/DOCKER_* forwarded), log streaming via `subprocess.iterable()`, and container cleanup.
- **executor.ts** — Abstract `ContainerExecutor` base class for pluggable runtimes.

### CLI Layer (`src/cli/`) — High-level orchestration
- **pipeline-runner.ts** — Orchestrates sequential step execution. Computes SHA256 fingerprints (image + cmd + env + sorted inputs + mounts) for cache invalidation. Each step execution produces a **run** with artifacts, captured logs (stdout.log/stderr.log), and structured metadata (meta.json). Mounts previous run artifacts as inputs. Supports `allowFailure` and `force` (skip cache) options.
- **state.ts** — Persists step fingerprints and run IDs to `state.json` per workspace. Handles cache hit detection and invalidation propagation through dependent steps.
- **pipeline-loader.ts** — Validates pipeline JSON configs with security checks (no path traversal, relative host mounts only, absolute container paths, alphanumeric IDs).
- **reporter.ts** — Two implementations: `ConsoleReporter` (structured JSON via Pino) and `InteractiveReporter` (colored spinners via ora/chalk).
- **index.ts** — CLI entry point using Commander.js.

### Kits Layer (`src/kits/`) — Reusable step templates
- **index.ts** — Kit registry. A `Kit` has a `name` and a `resolve(params)` method that returns a `KitOutput` (image, cmd, env, caches, mounts, sources, allowNetwork). Kits are selected via `uses` in pipeline definitions.
- **builtin/shell.ts** — General-purpose shell command runner. Without `packages`: alpine, no network. With `packages`: debian + apt-get install + apt cache + network. Accepts `run`, `packages`, `image`, `src`.
- **builtin/node.ts** — Node.js script runner with npm/pnpm/yarn install and cache.
- **builtin/python.ts** — Python script runner with pip/uv install and cache.

Kit resolution happens in `PipelineLoader.resolveKitStep()`: `uses` selects the kit, `with` passes parameters, and user-level `env`/`caches`/`mounts`/`sources` merge with kit defaults (user values win). The `node` kit uses `sources` (not `mounts`) for `src` so that `node_modules` can be created alongside source files in the container's writable layer.

### Execution Flow
```
CLI → PipelineRunner.run() → PipelineLoader.load() → Workspace.create()
  → For each step: fingerprint check → prepareRun → DockerCliExecutor.run() (with log capture) → write meta.json → commitRun/discardRun → update state
```

## Code Style

- ESM modules (NodeNext), target ES2024, strict TypeScript
- XO linter: no semicolons, 2-space indent
- `@typescript-eslint/naming-convention` is disabled
- `no-await-in-loop` is disabled (sequential step execution is intentional)
