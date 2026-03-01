# CLAUDE.md

## Project Overview

Tylt is a containerized pipeline execution engine. Each step runs in an isolated Docker container with fingerprint-based caching.

## Commands

```bash
npm run cli -- run [pipeline]    # Run pipeline (dev mode via tsx)
npm run build                    # Compile TypeScript (tsc → dist/)
npm test                         # Run unit tests with AVA
npm run lint                     # Lint with XO
npm run lint:fix                 # Auto-fix lint issues
```

## Structure

Monorepo with npm workspaces: `packages/core` (library) and `packages/cli`.

## Code Style

- ESM modules (NodeNext), target ES2024, strict TypeScript
- XO linter: no semicolons, 2-space indent
- `@typescript-eslint/naming-convention` is disabled
- `no-await-in-loop` is disabled (sequential step execution is intentional)
