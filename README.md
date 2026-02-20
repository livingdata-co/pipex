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

The `run` command accepts a pipeline file path, a directory, or nothing (defaults to current directory). When given a directory (or no argument), pipex looks for `pipeline.yml`, `pipeline.yaml`, or `pipeline.json` in order.

```bash
# Run from current directory (auto-detects pipeline file)
pipex run

# Run from a directory
pipex run examples/geodata/

# Run a specific file
pipex run pipeline.yaml

# JSON mode (for CI/CD)
pipex run --json

# Custom workdir
pipex run --workdir /tmp/builds
```

### Interactive step execution

Execute individual steps without a full pipeline file — useful for iterative, exploratory, or agent-driven workflows:

```bash
# Create a step file
cat > step.yaml <<'EOF'
uses: shell
with:
  run: "echo hello > /output/greeting.txt"
EOF

# Execute a single step in a workspace
pipex exec my-workspace -f step.yaml --step greet

# Read artifact content
pipex cat my-workspace greet                    # list artifacts
pipex cat my-workspace greet greeting.txt       # read a file

# Ephemeral mode: stream stdout, don't commit run
pipex exec my-workspace -f step.yaml --step greet --ephemeral

# Chain steps via --input
pipex exec my-workspace -f process.yaml --step process --input greet

# Aliased inputs (mount under /input/data instead of /input/greet)
pipex exec my-workspace -f process.yaml --step process --input data=greet

# Remove a step's run and state entry
pipex rm-step my-workspace greet
```

### Inspecting runs

Each step execution produces a **run** containing artifacts, logs (stdout/stderr), and metadata:

```bash
# Show all steps and their last run (status, duration, size, date)
pipex show my-pipeline

# Show logs from the last run of a step
pipex logs my-pipeline download
pipex logs my-pipeline download --stream stderr

# Show execution metadata (image, cmd, duration, exit code, fingerprint…)
pipex inspect my-pipeline download
pipex inspect my-pipeline download --json

# Export artifacts from a step to the host filesystem
pipex export my-pipeline download ./output-dir
```

### Managing workspaces

```bash
# List workspaces (with run/cache counts and disk size)
pipex list
pipex ls --json

# Remove old runs (keeps only current ones)
pipex prune my-pipeline

# Remove specific workspaces
pipex rm my-build other-build

# Remove all workspaces
pipex clean
```

### Commands

| Command | Description |
|---------|-------------|
| `run [pipeline]` | Execute a pipeline (file, directory, or cwd) |
| `exec <workspace> -f <step-file>` | Execute a single step in a workspace |
| `cat <workspace> <step> [path]` | Read or list artifact content from a step's latest run |
| `show <workspace>` | Show steps and runs in a workspace |
| `logs <workspace> <step>` | Show stdout/stderr from last run |
| `inspect <workspace> <step>` | Show run metadata (meta.json) |
| `export <workspace> <step> <dest>` | Extract artifacts from a step run to the host filesystem |
| `prune <workspace>` | Remove old runs not referenced by current state |
| `list` (alias `ls`) | List workspaces (with disk sizes) |
| `rm <workspace...>` | Remove one or more workspaces |
| `rm-step <workspace> <step>` | Remove a step's run and state entry |
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
| `--dry-run` | | Validate pipeline, compute fingerprints, show what would run without executing |
| `--target <steps>` | `-t` | Execute only these steps and their dependencies (comma-separated) |
| `--concurrency <n>` | `-c` | Max parallel step executions (default: CPU count) |
| `--env-file <path>` | | Load environment variables from a dotenv file for all steps |
| `--verbose` | | Stream container logs in real-time (interactive mode) |

### Exec Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--file <path>` | `-f` | Step definition file (YAML or JSON, required) |
| `--step <id>` | | Step ID (overrides file's id/name) |
| `--input <specs...>` | | Input steps (e.g. `extract` or `data=extract`) |
| `--ephemeral` | | Stream stdout to terminal and discard the run |
| `--force` | | Skip cache check |
| `--verbose` | | Stream container logs in real-time |

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
  - id: transform
    uses: node
    with: { script: transform.js, src: src/app }
  - id: convert
    uses: node
    with: { run: "node /app/convert.js --format csv --output /output/", src: src/app }
  - id: analyze
    uses: python
    with: { script: analyze.py, src: scripts }
  - id: enrich
    uses: python
    with: { run: "python /app/enrich.py --locale fr --input /input/analyze/", src: scripts/ }
    inputs: [{ step: analyze }]
  - id: extract
    uses: shell
    with: { packages: [unzip], run: "unzip /input/transform/archive.zip -d /output/" }
    inputs: [{ step: transform }]
```

`uses` and `image`/`cmd` are mutually exclusive. All other step fields (`env`, `inputs`, `mounts`, `sources`, `caches`, `timeoutSec`, `allowFailure`, `allowNetwork`) remain available and merge with kit defaults (user values take priority). The `src` parameter in `with` copies the host directory into `/app` in the container's writable layer (see [Sources](#sources)).

#### Available Kits

**`node`** -- Run a Node.js command with automatic dependency installation.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `script` | -- | Script to run (relative to `/app`). Mutually exclusive with `run`. |
| `run` | -- | Arbitrary shell command. Mutually exclusive with `script`. |
| `src` | -- | Host directory to copy into `/app` |
| `version` | `"24"` | Node.js version |
| `packageManager` | `"npm"` | `"npm"`, `"pnpm"`, or `"yarn"` |
| `install` | `true` | Run package install before command |
| `variant` | `"alpine"` | Image variant |

Exactly one of `script` or `run` is required. `script: transform.js` is shorthand for `run: node /app/transform.js`. Use `run` to pass arguments or call any command available in the container.

**`python`** -- Run a Python command with automatic dependency installation from `requirements.txt`.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `script` | -- | Script to run (relative to `/app`). Mutually exclusive with `run`. |
| `run` | -- | Arbitrary shell command. Mutually exclusive with `script`. |
| `src` | -- | Host directory to copy into `/app` |
| `version` | `"3.12"` | Python version |
| `packageManager` | `"pip"` | `"pip"` or `"uv"` |
| `install` | `true` | Run dependency install before command |
| `variant` | `"slim"` | Image variant |

Exactly one of `script` or `run` is required. `script: analyze.py` is shorthand for `run: python /app/analyze.py`. Use `run` to pass arguments or call any command available in the container.

**`shell`** -- Run a shell command in a container, with optional apt package installation.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `run` | *(required)* | Shell command to execute |
| `packages` | -- | Apt packages to install before running |
| `src` | -- | Host directory to mount read-only at `/app` |
| `image` | `"alpine:3.20"` | Docker image (defaults to `"debian:bookworm-slim"` when `packages` is set) |

When `packages` is provided, the kit switches to a Debian image and installs packages in a setup phase (with network access and an exclusive `apt-cache` cache). The user command runs in the isolated run phase. Without packages, it runs on a minimal Alpine image with no network and no setup phase.

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
| `setup` | SetupSpec | Optional setup phase (see [Setup Phase](#setup-phase)) |
| `uses` | string | Kit name (required for kit steps) |
| `with` | object | Kit parameters |
| `inputs` | InputSpec[] | Previous steps to mount as read-only |
| `env` | Record<string, string> | Environment variables |
| `envFile` | string | Path to a dotenv file (relative to pipeline file) |
| `outputPath` | string | Output mount point (default: `/output`) |
| `mounts` | MountSpec[] | Host directories to bind mount (read-only) |
| `sources` | MountSpec[] | Host directories copied into the container's writable layer |
| `caches` | CacheSpec[] | Persistent caches to mount |
| `if` | string | Condition expression — step is skipped when it evaluates to false |
| `timeoutSec` | number | Execution timeout |
| `retries` | number | Number of retry attempts on transient failure |
| `retryDelayMs` | number | Delay between retries (default: 5000) |
| `allowFailure` | boolean | Continue pipeline if step fails |
| `allowNetwork` | boolean | Enable network access |

### Step Dependencies and Parallel Execution

Steps declare dependencies via `inputs`. Pipex automatically determines which steps can run in parallel based on the dependency graph. Steps at the same level (no dependency between them) execute concurrently, up to `--concurrency` (defaults to CPU count).

```yaml
steps:
  - id: download
    # ...
  - id: process-a
    inputs: [{ step: download }]      # waits for download
  - id: process-b
    inputs: [{ step: download }]      # waits for download
  # process-a and process-b run in parallel
  - id: merge
    inputs: [{ step: process-a }, { step: process-b }]  # waits for both
```

#### Inputs

Mount previous steps as read-only:

```yaml
inputs:
  - step: step1
  - step: step2
    copyToOutput: true
  - step: step3
    optional: true
```

- Mounted under `/input/{stepName}/`
- `copyToOutput: true` copies content to output before execution
- `optional: true` allows the step to run even if the dependency failed or was skipped

#### Targeted Execution

Use `--target` to execute only specific steps and their dependencies:

```bash
# Only run 'merge' and everything it depends on
pipex run pipeline.yaml --target merge

# Multiple targets
pipex run pipeline.yaml --target process-a,process-b
```

### Conditional Steps

Steps can be conditionally skipped using `if:` with a [JEXL](https://github.com/TomFrost/Jexl) expression. The expression is evaluated against the current environment variables via `env`:

```yaml
- id: notify
  if: env.CI
  uses: shell
  with:
    run: echo "Running in CI"

- id: deploy
  if: env.NODE_ENV == "production"
  uses: shell
  with:
    run: echo "Deploying..."
```

When a condition evaluates to false, the step is skipped. Steps that depend on a skipped step with a required (non-optional) input are also skipped.

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

### Sources

Copy host directories into the container's **writable layer**. Unlike bind mounts, copied files live inside the container so the step can create new files and subdirectories alongside them (e.g. `node_modules` after `npm install`).

```yaml
sources:
  - host: src/app
    container: /app
```

- Same path rules as `mounts` (`host` relative, `container` absolute, no `..`)
- Files are snapshotted at step start -- changes on the host during execution are not reflected
- The container can write next to source files without affecting the host

**When to use `sources` vs `mounts`**:
- Use `sources` when the step needs to write alongside the source files (install dependencies, generate build artifacts next to sources)
- Use `mounts` when read-only access is sufficient (config files, static data)

Kits use `sources` internally: the `node` kit's `src` parameter copies into `/app` so that `npm install` can create `node_modules`.

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

### Setup Phase

Steps can define an optional `setup` phase that runs before the main command. This is used by kits to isolate dependency installation from execution, enabling safe parallel runs with shared caches.

```yaml
setup:
  cmd: [sh, -c, "apt-get update && apt-get install -y curl"]
  caches:
    - name: apt-cache
      path: /var/cache/apt
      exclusive: true
  allowNetwork: true
```

| Field | Type | Description |
|-------|------|-------------|
| `cmd` | string[] | Command to execute during setup |
| `caches` | CacheSpec[] | Caches needed during setup (supports `exclusive`) |
| `allowNetwork` | boolean | Enable network access during setup |

When `exclusive: true` is set on a setup cache, an in-memory mutex ensures only one step at a time can write to that cache. After setup completes, the lock is released and the run phase executes without holding any locks.

Built-in kits use this automatically: when `install` is enabled (the default), the install command runs in a setup phase with exclusive cache access and network, while the user command runs in the parallel-safe run phase.

## Examples

### Geodata Processing

The `examples/geodata/` pipeline downloads a shapefile archive, extracts it, and produces a CSV inventory. The last two steps run in parallel:

```
examples/geodata/
└── pipeline.yaml
```

Steps: `download` → `extract` → `list-files` / `build-csv`

```bash
pipex run examples/geodata/
```

### Text Processing

The `examples/text-processing/` pipeline demonstrates parallel branches, conditional steps, and optional inputs:

```
examples/text-processing/
└── pipeline.yaml
```

Steps: `generate` → `stats` + `filter` (parallel) → `report` → `notify` (conditional), with `audit` (conditional, optional input to `notify`)

```bash
# Default: notify and audit are skipped (conditions not met)
pipex run examples/text-processing/

# Enable notifications
NOTIFY=1 pipex run examples/text-processing/

# Only run stats and its dependencies
pipex run examples/text-processing/ --target stats
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
pipex run examples/multi-language/
```

## Caching & Workspaces

Workspaces enable caching across runs. The workspace ID is determined by:
1. CLI flag `--workspace` (highest priority)
2. Pipeline `id` (explicit or derived from `name`)

**Cache behavior**: Steps are skipped if image, cmd, setup cmd, env (including values from `envFile` and `--env-file`), inputs, and mounts haven't changed. See code documentation for details.

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

### Cached step with missing run

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
npm run cli -- run                # auto-detects pipeline file in cwd
npm run cli -- run pipeline.yaml  # explicit file
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
