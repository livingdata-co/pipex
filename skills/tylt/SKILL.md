---
name: tylt
description: Guide for using Tylt, a containerized pipeline execution engine. Use when building, debugging, or running Tylt pipelines (YAML/JSON), writing pipeline steps (kit or raw), using the Tylt CLI (run, exec, show, logs, inspect, export, list, prune, rm, clean), or understanding Tylt concepts (workspaces, caching, fingerprinting, inputs, mounts, sources, caches, kits).
---

# Tylt

Containerized pipeline execution engine. Each step runs in an isolated Docker container. Tylt manages artifacts, logs, metadata, caches, and dependencies between steps with fingerprint-based caching.

## CLI Quick Reference

```bash
tylt run                                    # Auto-detect pipeline.yml/yaml/json in cwd
tylt run examples/geodata/                  # Auto-detect pipeline file in directory
tylt run pipeline.yaml                      # Explicit pipeline file
tylt run --workspace my-ws                  # Named workspace for caching
tylt run --force                            # Skip cache for all steps
tylt run --force step1,step2               # Skip cache for specific steps
tylt run --target merge                     # Run only 'merge' + its dependencies
tylt run --concurrency 4                    # Limit parallel steps
tylt run --env-file .env                     # Load env vars from file for all steps
tylt run --dry-run                          # Validate without executing
tylt run --verbose                          # Stream container logs live
tylt run --json                             # Structured JSON output (CI/CD)
tylt run --detach                           # Run in background (daemon mode)
tylt run --attach                           # Force in-process (override detach config)

tylt attach <workspace>                     # Attach to a running pipeline

tylt exec <ws> -f step.yaml --step <id>     # Execute a single step
tylt exec <ws> -f step.yaml --step <id> --input prev-step  # Chain steps
tylt exec <ws> -f step.yaml --step <id> --ephemeral        # Stream stdout, discard run

tylt show <workspace>                       # Steps + runs overview
tylt logs <workspace> <step>                # Stdout from last run
tylt logs <workspace> <step> --stream stderr
tylt inspect <workspace> <step>             # Run metadata (meta.json)
tylt export <workspace> <step> ./out        # Extract artifacts to host

tylt cat <workspace> <step>                 # List artifacts
tylt cat <workspace> <step> file.txt        # Read artifact content

tylt list                                   # List workspaces with sizes
tylt prune <workspace>                      # Remove old runs, keep current
tylt rm <workspace...>                      # Remove workspaces
tylt rm-step <workspace> <step>             # Remove a step's run + state
tylt clean                                  # Remove all workspaces
```

## Pipeline Structure

Pipeline files: YAML (recommended) or JSON. Minimal structure:

```yaml
name: My Pipeline          # or id: my-pipeline (at least one required)
steps:
  - id: step-name
    # ... step definition (kit or raw)
```

Identity rules: `id` is the machine identifier (alphanumeric, dash, underscore). `name` is a human-readable label. At least one is required. If `id` is omitted, it's derived from `name` via slugification.

## Step Types

Two mutually exclusive approaches — choose based on needs:

### Kit Steps (`uses`)

Use a kit when a built-in template covers the runtime. Kits handle image selection, dependency installation, and cache setup automatically.

```yaml
- id: transform
  uses: node
  with: { script: transform.js, src: src/app }

- id: convert
  uses: node
  with: { run: "node /app/convert.js --format csv --output /output/", src: src/app }

- id: analyze
  uses: python
  with: { script: analyze.py, src: scripts/ }

- id: enrich
  uses: python
  with: { run: "python /app/enrich.py --locale fr --input /input/analyze/", src: scripts/ }
  inputs: [{ step: analyze }]

- id: extract
  uses: shell
  with: { packages: [unzip], run: "unzip /input/build/archive.zip -d /output/" }
  inputs: [{ step: build }]
```

Three built-in kits: `shell`, `node`, `python`. The `node` and `python` kits accept either `script` (shorthand) or `run` (arbitrary command, useful for passing arguments or calling other tools). Kits use a two-phase execution model: dependency installation runs in a setup phase (with exclusive cache locking and network), then the user command runs in a parallel-safe run phase. See [references/kits.md](references/kits.md) for parameters and details.

### Raw Steps (`image` + `cmd`)

Use raw steps for full control over image and command:

```yaml
- id: download
  image: alpine:3.19
  cmd: [sh, -c, "curl -o /output/data.zip https://example.com/data.zip"]
  allowNetwork: true

- id: process
  image: python:3.12-slim
  cmd: [python, /app/process.py]
  inputs: [{ step: download }]
  sources:
    - host: scripts/
      container: /app
```

### When to Choose Which

- **Kit**: Standard Node.js/Python/shell tasks with dependency installation. Less boilerplate.
- **Raw**: Custom images, complex entrypoints, non-standard runtimes, fine-grained control.

## Inputs and Dependencies

Steps declare dependencies via `inputs`. Tylt resolves the DAG and runs independent steps in parallel.

```yaml
- id: process-a
  inputs: [{ step: download }]         # waits for download
- id: process-b
  inputs: [{ step: download }]         # waits for download
# process-a and process-b run in parallel
- id: merge
  inputs: [{ step: process-a }, { step: process-b }]  # waits for both
```

Input artifacts are mounted read-only at `/input/{stepId}/`. Options:
- `copyToOutput: true` — pre-copies content to `/output/` before execution
- `optional: true` — step runs even if dependency failed or was skipped

## Detailed Reference

For complete step options (env, mounts, sources, caches, conditionals, timeouts, retries) see [references/pipeline-format.md](references/pipeline-format.md).

For kit parameters and behavior see [references/kits.md](references/kits.md).
