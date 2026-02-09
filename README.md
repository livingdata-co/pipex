# Pipex

Execution engine for containerized steps via Docker CLI.

Runs containers with explicit volume mounts and manages artifacts through a staging/commit lifecycle. Designed to be driven by different orchestrators (CLI included, AI agent planned).

## Installation

```bash
npm install
cp .env.example .env
# Edit .env to set PIPEX_WORKDIR if needed (defaults to ./workdir)
```

## Prerequisites

- Node.js 24+
- Docker CLI installed and accessible

## Usage

### Running a pipeline

```bash
# Interactive mode (default)
npm start -- run pipeline.example.json

# With workspace name (enables caching)
npm start -- run pipeline.example.json --workspace my-build

# JSON mode (for CI/CD)
npm start -- run pipeline.example.json --json

# Custom workdir
npm start -- run pipeline.example.json --workdir /tmp/builds
```

### Managing workspaces

```bash
# List workspaces (with artifact/cache counts)
npm start -- list
npm start -- ls --json

# Remove specific workspaces
npm start -- rm my-build other-build

# Remove all workspaces
npm start -- clean
```

### Via npx

```bash
# Build first
npm run build

# Run locally via npx
npx . run example/pipeline.json --workspace my-build
npx . list
```

### Commands

| Command | Description |
|---------|-------------|
| `run <pipeline>` | Execute a pipeline |
| `list` (alias `ls`) | List workspaces |
| `rm <workspace...>` | Remove one or more workspaces |
| `clean` | Remove all workspaces |

### Global Options

| Option | Description |
|--------|-------------|
| `--workdir <path>` | Workspaces root directory (default: `./workdir`) |
| `--json` | Structured JSON logs instead of interactive UI |

### Run Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--workspace <name>` | `-w` | Workspace name for caching |
| `--force [steps]` | `-f` | Skip cache for all steps, or a comma-separated list |

## Pipeline Format

Minimal example:

```json
{
  "name": "my-pipeline",
  "steps": [
    {
      "id": "download",
      "image": "alpine:3.19",
      "cmd": ["sh", "-c", "echo hello > /output/hello.txt"]
    },
    {
      "id": "process",
      "image": "alpine:3.19",
      "cmd": ["cat", "/input/download/hello.txt"],
      "inputs": [{"step": "download"}]
    }
  ]
}
```

### Step Options

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Step identifier (required) |
| `image` | string | Docker image (required) |
| `cmd` | string[] | Command to execute (required) |
| `inputs` | InputSpec[] | Previous steps to mount as read-only |
| `env` | Record<string, string> | Environment variables |
| `outputPath` | string | Output mount point (default: `/output`) |
| `mounts` | MountSpec[] | Host directories to bind mount (read-only) |
| `caches` | CacheSpec[] | Persistent caches to mount |
| `timeoutSec` | number | Execution timeout |
| `allowFailure` | boolean | Continue pipeline if step fails |
| `allowNetwork` | boolean | Enable network access |

### Inputs

Mount previous steps as read-only:

```json
"inputs": [
  {"step": "step1"},
  {"step": "step2", "copyToOutput": true}
]
```

- Mounted under `/input/{stepName}/`
- `copyToOutput: true` copies content to output before execution

### Host Mounts

Mount host directories into containers as **read-only**:

```json
"mounts": [
  {"host": "src/app", "container": "/app"},
  {"host": "config", "container": "/config"}
]
```

- `host` must be a **relative** path (resolved from the pipeline file's directory)
- `container` must be an **absolute** path
- Neither path can contain `..`
- Always mounted read-only -- containers cannot modify host files

This means a pipeline at `/project/ci/pipeline.json` can only mount subdirectories of `/project/ci/`. Use `/tmp` or `/output` inside the container for writes.

### Caches

Persistent read-write directories shared across steps and executions:

```json
"caches": [
  {"name": "pnpm-store", "path": "/root/.local/share/pnpm/store"},
  {"name": "build-cache", "path": "/tmp/cache"}
]
```

- **Persistent**: Caches survive across pipeline executions
- **Shared**: Multiple steps can use the same cache
- **Mutable**: Steps can read and write to caches

Common use cases:
- Package manager caches (pnpm, npm, cargo, maven)
- Build caches (gradle, ccache)
- Downloaded assets

**Note**: Caches are workspace-scoped (not global). Different workspaces have isolated caches.

## Example

The `example/` directory contains a multi-language pipeline that chains Node.js and Python steps:

```
example/
├── pipeline.json
└── scripts/
    ├── nodejs/          # lodash-based data analysis
    │   ├── package.json
    │   ├── analyze.js
    │   └── transform.js
    └── python/          # pyyaml-based enrichment
        ├── pyproject.toml
        ├── analyze.py
        └── transform.py
```

The pipeline runs 4 steps: `node-analyze` → `node-transform` → `python-analyze` → `python-transform`. Each step mounts its scripts directory as read-only and passes artifacts to the next step via `/input`.

```bash
npm start -- run example/pipeline.json --workspace example-test
```

## Caching & Workspaces

Workspaces enable caching across runs. Name is determined by:
1. CLI flag `--workspace` (highest priority)
2. Config `"name"` field
3. Filename (e.g., `build.json` → `build`)
4. Auto-generated timestamp

**Cache behavior**: Steps are skipped if image, cmd, env, inputs, and mounts haven't changed. See code documentation for details.

## Troubleshooting

### Docker not found

```bash
# Verify Docker is accessible
docker --version
docker ps
```

### Permission denied (Linux)

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Workspace disk full

Clean old workspaces:

```bash
npm start -- list
npm start -- rm old-workspace-id
# Or remove all at once
npm start -- clean
```

### Cached step with missing artifact

Force re-execution:

```bash
rm $PIPEX_WORKDIR/{workspace-id}/state.json
```

## Development

```bash
npm run build
npm run lint
npm run lint:fix
```

## Architecture

For implementation details, see code documentation in:
- `src/engine/` - Low-level container execution (workspace, executor)
- `src/cli/` - Pipeline orchestration (runner, loader, state)
