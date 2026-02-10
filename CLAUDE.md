# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pipex is a containerized pipeline execution engine that runs multi-step pipelines where each step executes in an isolated Docker container. It manages artifacts, caches, and dependencies between steps with fingerprint-based caching.

## Commands

```bash
pipex run <pipeline.yaml> --workspace <name>           # Run pipeline (published binary)
pipex list                                             # List workspaces
pipex rm <workspace>                                   # Remove workspace
pipex clean                                            # Remove all workspaces
npm run cli -- run <pipeline.yaml> --workspace <name>  # Run pipeline (dev mode via tsx)
npm run build                                          # Compile TypeScript (tsc → dist/)
npm run lint                                           # Lint with XO
npm run lint:fix                                       # Auto-fix lint issues
```

No test framework is currently configured.

## Architecture

Two-layer design:

### Engine Layer (`src/engine/`) — Low-level container execution
- **workspace.ts** — Manages isolated execution environments with three directory types: `staging/` (temporary write), `artifacts/` (committed immutable outputs), `caches/` (persistent read-write shared across steps). Two-phase artifact lifecycle: prepare → commit/discard.
- **docker-executor.ts** — Implements `ContainerExecutor` abstract class using Docker CLI via `execa`. Handles mount configuration (inputs=read-only, output=read-write, caches=read-write, host mounts=read-only), environment isolation (only PATH/HOME/DOCKER_* forwarded), log streaming, and container cleanup.
- **executor.ts** — Abstract `ContainerExecutor` base class for pluggable runtimes.

### CLI Layer (`src/cli/`) — High-level orchestration
- **pipeline-runner.ts** — Orchestrates sequential step execution. Computes SHA256 fingerprints (image + cmd + env + sorted inputs + mounts) for cache invalidation. Mounts previous step artifacts as inputs. Supports `allowFailure` and `force` (skip cache) options.
- **state.ts** — Persists step fingerprints and artifact IDs to `state.json` per workspace. Handles cache hit detection and invalidation propagation through dependent steps.
- **pipeline-loader.ts** — Validates pipeline JSON configs with security checks (no path traversal, relative host mounts only, absolute container paths, alphanumeric IDs).
- **reporter.ts** — Two implementations: `ConsoleReporter` (structured JSON via Pino) and `InteractiveReporter` (colored spinners via ora/chalk).
- **index.ts** — CLI entry point using Commander.js.

### Execution Flow
```
CLI → PipelineRunner.run() → PipelineLoader.load() → Workspace.create()
  → For each step: fingerprint check → prepare artifact → DockerCliExecutor.run() → commit/discard artifact → update state
```

## Code Style

- ESM modules (NodeNext), target ES2024, strict TypeScript
- XO linter: no semicolons, 2-space indent
- `@typescript-eslint/naming-convention` is disabled
- `no-await-in-loop` is disabled (sequential step execution is intentional)
