# @livingdata/pipex

Command-line interface for the Pipex containerized pipeline engine.

## Installation

```bash
npx @livingdata/pipex run pipeline.yaml
```

Or install globally:

```bash
npm install -g @livingdata/pipex
pipex run pipeline.yaml
```

## Usage

The `run` command accepts a pipeline file path, a directory, or nothing (defaults to current directory). When given a directory, pipex looks for `pipeline.yml`, `pipeline.yaml`, or `pipeline.json` in order.

```bash
pipex run                           # auto-detect pipeline file in cwd
pipex run examples/geodata/        # run from a directory
pipex run pipeline.yaml            # run a specific file
pipex run --json                   # JSON mode (for CI/CD)
pipex run --workdir /tmp/builds    # custom workdir
```

### Interactive step execution

Execute individual steps without a full pipeline file:

```bash
pipex exec my-workspace -f step.yaml --step greet
pipex cat my-workspace greet greeting.txt
pipex exec my-workspace -f step.yaml --step greet --ephemeral
pipex exec my-workspace -f process.yaml --step process --input greet
pipex exec my-workspace -f process.yaml --step process --input data=greet
pipex rm-step my-workspace greet
```

### Inspecting runs

Each step execution produces a **run** with artifacts, logs (stdout/stderr), and metadata:

```bash
pipex show my-pipeline
pipex logs my-pipeline download
pipex logs my-pipeline download --stream stderr
pipex inspect my-pipeline download
pipex inspect my-pipeline download --json
pipex export my-pipeline download ./output-dir
```

### Managing workspaces

```bash
pipex list
pipex ls --json
pipex prune my-pipeline
pipex rm my-build other-build
pipex clean
```

## Commands

| Command | Description |
|---------|-------------|
| `run [pipeline]` | Execute a pipeline (file, directory, or cwd) |
| `exec <workspace> -f <step-file>` | Execute a single step in a workspace |
| `cat <workspace> <step> [path]` | Read or list artifact content from a step's latest run |
| `show <workspace>` | Show steps and runs in a workspace |
| `logs <workspace> <step>` | Show stdout/stderr from last run |
| `inspect <workspace> <step>` | Show run metadata (meta.json) |
| `export <workspace> <step> <dest>` | Extract artifacts to the host filesystem |
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

Pipeline files can be written in **YAML** or **JSON**. Steps can be **raw** (explicit image/cmd) or **kit-based** (using `uses`).

### Raw Steps

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

### Kit Steps

```yaml
steps:
  - id: transform
    uses: node
    with: { script: transform.js, src: src/app }
  - id: analyze
    uses: python
    with: { script: analyze.py, src: scripts }
  - id: extract
    uses: shell
    with: { packages: [unzip], run: "unzip /input/transform/archive.zip -d /output/" }
    inputs: [{ step: transform }]
```

See [`@livingdata/pipex-core`](../core/) for available kits and parameters.

### Pipeline and Step Identity

- **`id`** — Machine identifier (alphanum, dash, underscore). Used for caching, state, artifacts.
- **`name`** — Human-readable label. Used for display.
- At least one must be defined. If `id` is missing, it is derived from `name` via slugification.

### Step Options

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Step identifier (at least one of `id`/`name` required) |
| `name` | string | Human-readable display name |
| `image` | string | Docker image (required for raw steps) |
| `cmd` | string[] | Command to execute (required for raw steps) |
| `setup` | SetupSpec | Optional setup phase |
| `uses` | string | Kit name (required for kit steps) |
| `with` | object | Kit parameters |
| `inputs` | InputSpec[] | Previous steps to mount as read-only |
| `env` | Record | Environment variables |
| `envFile` | string | Path to a dotenv file (relative to pipeline file) |
| `outputPath` | string | Output mount point (default: `/output`) |
| `mounts` | MountSpec[] | Host directories to bind mount (read-only) |
| `sources` | MountSpec[] | Host directories copied into the container's writable layer |
| `caches` | CacheSpec[] | Persistent caches to mount |
| `if` | string | JEXL condition expression — step is skipped when false |
| `timeoutSec` | number | Execution timeout |
| `retries` | number | Number of retry attempts on transient failure |
| `retryDelayMs` | number | Delay between retries (default: 5000) |
| `allowFailure` | boolean | Continue pipeline if step fails |
| `allowNetwork` | boolean | Enable network access |

### Dependencies and Parallel Execution

Steps declare dependencies via `inputs`. Independent steps run in parallel up to `--concurrency`.

```yaml
steps:
  - id: download
    # ...
  - id: process-a
    inputs: [{ step: download }]
  - id: process-b
    inputs: [{ step: download }]
  # process-a and process-b run in parallel
  - id: merge
    inputs: [{ step: process-a }, { step: process-b }]
```

#### Inputs

- Mounted under `/input/{stepName}/`
- `copyToOutput: true` copies content to output before execution
- `optional: true` allows the step to run even if the dependency failed or was skipped

#### Targeted Execution

```bash
pipex run pipeline.yaml --target merge
pipex run pipeline.yaml --target process-a,process-b
```

### Conditional Steps

Use `if:` with a [JEXL](https://github.com/TomFrost/Jexl) expression evaluated against `env`:

```yaml
- id: deploy
  if: env.NODE_ENV == "production"
  uses: shell
  with:
    run: echo "Deploying..."
```

### Host Mounts

Mount host directories as **read-only**:

```yaml
mounts:
  - host: src/app       # relative path (from pipeline file directory)
    container: /app     # absolute path
```

### Sources

Copy host directories into the container's **writable layer**:

```yaml
sources:
  - host: src/app
    container: /app
```

Use `sources` when the step needs to write alongside source files (e.g. `node_modules`). Use `mounts` for read-only access.

### Caches

Persistent read-write directories shared across steps and executions:

```yaml
caches:
  - name: pnpm-store
    path: /root/.local/share/pnpm/store
```

### Setup Phase

Optional phase that runs before the main command, used by kits for dependency installation:

```yaml
setup:
  cmd: [sh, -c, "apt-get update && apt-get install -y curl"]
  caches:
    - name: apt-cache
      path: /var/cache/apt
      exclusive: true
  allowNetwork: true
```

## Caching & Workspaces

Workspaces enable caching across runs. The workspace ID is determined by:
1. CLI flag `--workspace` (highest priority)
2. Pipeline `id` (explicit or derived from `name`)

Steps are skipped when image, command, setup command, env, inputs, and mounts haven't changed.

## Troubleshooting

### Docker not found

```bash
docker --version
docker ps
```

### Permission denied (Linux)

```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Workspace disk full

```bash
pipex list
pipex rm old-workspace-id
pipex clean
```

### Force re-execution

```bash
pipex run --force
pipex run --force download,process
```
