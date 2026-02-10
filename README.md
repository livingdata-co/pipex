# Pipex

Execution engine for containerized steps via Docker CLI.

Runs containers with explicit volume mounts and manages artifacts through a staging/commit lifecycle. Designed to be driven by different orchestrators (CLI included, AI agent planned).

## Prerequisites

- Node.js 24+
- Docker CLI installed and accessible

## Quick Start

Run directly without installing:

```bash
npx @livingdata/pipex run pipeline.yaml
```

Or install globally:

```bash
npm install -g @livingdata/pipex
pipex run pipeline.yaml
```

## Usage

```bash
# Interactive mode (default)
pipex run pipeline.yaml

# JSON mode (for CI/CD)
pipex run pipeline.yaml --json

# Custom workdir
pipex run pipeline.yaml --workdir /tmp/builds
```

### Managing workspaces

```bash
# List workspaces (with artifact/cache counts)
pipex list
pipex ls --json

# Remove specific workspaces
pipex rm my-build other-build

# Remove all workspaces
pipex clean
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

Pipeline files can be written in **YAML** (`.yaml` / `.yml`) or **JSON** (`.json`). YAML is recommended for readability; JSON is still fully supported.

Steps can be defined in two ways: **raw steps** with explicit image/cmd, or **kit steps** using `uses` for common patterns. Both can coexist in the same pipeline.

### Pipeline and Step Identity

Both pipelines and steps support an `id`/`name` duality:

- **`id`** — Machine identifier (alphanum, dash, underscore). Used for caching, state, artifacts.
- **`name`** — Human-readable label (free-form text). Used for display.
- At least one must be defined. If `id` is missing it is derived from `name` via slugification (e.g. `"Données préparées"` → `donnees-preparees`). If `name` is missing, `id` is used for display.

```yaml
# Pipeline with both id and name
id: data-pipeline
name: Data Processing Pipeline
steps:
  # Step with only id (current style, still works)
  - id: download
    image: alpine:3.19
    cmd: [sh, -c, "echo hello > /output/hello.txt"]

  # Step with only name (id auto-derived to "build-assets")
  - name: Build Assets
    image: node:22-alpine
    cmd: [sh, -c, "echo done > /output/result.txt"]

  # Step with both
  - id: deploy
    name: Deploy to Staging
    image: alpine:3.19
    cmd: [echo, deployed]
```

### Kit Steps

Kits are reusable templates that generate the image, command, caches, and mounts for common runtimes. Use `uses` to select a kit and `with` to pass parameters:

```yaml
name: my-pipeline
steps:
  - id: build
    uses: node
    with: { script: build.js, src: src/app }
  - id: analyze
    uses: python
    with: { script: analyze.py, src: scripts }
  - id: extract
    uses: shell
    with: { packages: [unzip], run: "unzip /input/build/archive.zip -d /output/" }
    inputs: [{ step: build }]
```

`uses` and `image`/`cmd` are mutually exclusive. All other step fields (`env`, `inputs`, `mounts`, `caches`, `timeoutSec`, `allowFailure`, `allowNetwork`) remain available and merge with kit defaults (user values take priority). The `src` parameter in `with` generates a read-only mount at `/app` in the container.

#### Available Kits

**`node`** -- Run a Node.js script with automatic dependency installation.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `script` | *(required)* | Script to run (relative to `/app`) |
| `src` | -- | Host directory to mount at `/app` |
| `version` | `"24"` | Node.js version |
| `packageManager` | `"npm"` | `"npm"`, `"pnpm"`, or `"yarn"` |
| `install` | `true` | Run package install before script |
| `variant` | `"alpine"` | Image variant |

**`python`** -- Run a Python script with automatic dependency installation from `requirements.txt`.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `script` | *(required)* | Script to run (relative to `/app`) |
| `src` | -- | Host directory to mount at `/app` |
| `version` | `"3.12"` | Python version |
| `packageManager` | `"pip"` | `"pip"` or `"uv"` |
| `install` | `true` | Run dependency install before script |
| `variant` | `"slim"` | Image variant |

**`shell`** -- Run a shell command in a container, with optional apt package installation.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `run` | *(required)* | Shell command to execute |
| `packages` | -- | Apt packages to install before running |
| `src` | -- | Host directory to mount at `/app` |
| `image` | `"alpine:3.20"` | Docker image (defaults to `"debian:bookworm-slim"` when `packages` is set) |

When `packages` is provided, the kit automatically switches to a Debian image, enables network access, and provides an `apt-cache` cache. Without packages, it runs on a minimal Alpine image with no network.

```yaml
# Simple command (alpine, no network)
- id: list-files
  uses: shell
  with:
    run: ls -lhR /input/data/

# With system packages (debian, network + apt cache)
- id: extract
  uses: shell
  with:
    packages: [unzip, jq]
    run: unzip /input/download/data.zip -d /output/
  inputs: [{ step: download }]
```

### Raw Steps

For full control, define `image` and `cmd` directly:

```yaml
name: my-pipeline
steps:
  - id: download
    image: alpine:3.19
    cmd: [sh, -c, "echo hello > /output/hello.txt"]
  - id: process
    image: alpine:3.19
    cmd: [cat, /input/download/hello.txt]
    inputs: [{ step: download }]
```

### Step Options

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Step identifier (at least one of `id`/`name` required) |
| `name` | string | Human-readable display name |
| `image` | string | Docker image (required for raw steps) |
| `cmd` | string[] | Command to execute (required for raw steps) |
| `uses` | string | Kit name (required for kit steps) |
| `with` | object | Kit parameters |
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

```yaml
inputs:
  - step: step1
  - step: step2
    copyToOutput: true
```

- Mounted under `/input/{stepName}/`
- `copyToOutput: true` copies content to output before execution

### Host Mounts

Mount host directories into containers as **read-only**:

```yaml
mounts:
  - host: src/app
    container: /app
  - host: config
    container: /config
```

- `host` must be a **relative** path (resolved from the pipeline file's directory)
- `container` must be an **absolute** path
- Neither path can contain `..`
- Always mounted read-only -- containers cannot modify host files

This means a pipeline at `/project/ci/pipeline.yaml` can only mount subdirectories of `/project/ci/`. Use `/tmp` or `/output` inside the container for writes.

### Caches

Persistent read-write directories shared across steps and executions:

```yaml
caches:
  - name: pnpm-store
    path: /root/.local/share/pnpm/store
  - name: build-cache
    path: /tmp/cache
```

- **Persistent**: Caches survive across pipeline executions
- **Shared**: Multiple steps can use the same cache
- **Mutable**: Steps can read and write to caches

Common use cases:
- Package manager caches (pnpm, npm, cargo, maven)
- Build caches (gradle, ccache)
- Downloaded assets

**Note**: Caches are workspace-scoped (not global). Different workspaces have isolated caches.

## Examples

### Geodata Processing

The `examples/geodata/` pipeline downloads a shapefile archive, extracts it, and produces a CSV inventory — using the `debian` and `bash` kits:

```
examples/geodata/
└── pipeline.yaml
```

Steps: `download` → `extract` → `list-files` / `build-csv`

```bash
pipex run examples/geodata/pipeline.yaml
```

### Multi-Language

The `examples/multi-language/` pipeline chains Node.js and Python steps using kits:

```
examples/multi-language/
├── pipeline.yaml
└── scripts/
    ├── nodejs/              # lodash-based data analysis
    │   ├── package.json
    │   ├── analyze.js
    │   └── transform.js
    └── python/              # pyyaml-based enrichment
        ├── pyproject.toml
        ├── requirements.txt
        ├── analyze.py
        └── transform.py
```

Steps: `node-analyze` → `node-transform` → `python-analyze` → `python-transform`

```bash
pipex run examples/multi-language/pipeline.yaml
```

## Caching & Workspaces

Workspaces enable caching across runs. The workspace ID is determined by:
1. CLI flag `--workspace` (highest priority)
2. Pipeline `id` (explicit or derived from `name`)

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
pipex list
pipex rm old-workspace-id
# Or remove all at once
pipex clean
```

### Cached step with missing artifact

Force re-execution:

```bash
rm $PIPEX_WORKDIR/{workspace-id}/state.json
```

## Development

```bash
git clone https://github.com/livingdata-co/pipex.git
cd pipex
npm install
cp .env.example .env
```

Run the CLI without building (via tsx):

```bash
npm run cli -- run pipeline.yaml
npm run cli -- list
```

Other commands:

```bash
npm run build        # Compile TypeScript (tsc → dist/)
npm run lint         # Lint with XO
npm run lint:fix     # Auto-fix lint issues
```

## Architecture

For implementation details, see code documentation in:
- `src/engine/` - Low-level container execution (workspace, executor)
- `src/cli/` - Pipeline orchestration (runner, loader, state)
- `src/kits/` - Kit system (registry, built-in kit implementations)
