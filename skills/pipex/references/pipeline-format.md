# Pipeline Format Reference

## Step Options

| Field           | Type                  | Description                                                     |
|-----------------|-----------------------|-----------------------------------------------------------------|
| `id`            | string                | Machine identifier (alphanumeric, dash, underscore)             |
| `name`          | string                | Human-readable label (at least one of `id`/`name` required)    |
| `image`         | string                | Docker image (required for raw steps)                           |
| `cmd`           | string[]              | Command to execute (required for raw steps)                     |
| `uses`          | string                | Kit name (required for kit steps, mutually exclusive with `image`/`cmd`) |
| `with`          | object                | Kit parameters                                                  |
| `inputs`        | InputSpec[]           | Previous steps to mount as read-only at `/input/{stepId}/`      |
| `env`           | Record<string,string> | Environment variables passed to the container                   |
| `envFile`       | string                | Path to a dotenv file (relative to pipeline file)               |
| `outputPath`    | string                | Output mount point (default: `/output`)                         |
| `mounts`        | MountSpec[]           | Host directories to bind mount read-only                        |
| `sources`       | MountSpec[]           | Host directories copied into the container's writable layer     |
| `caches`        | CacheSpec[]           | Persistent read-write directories shared across executions      |
| `if`            | string                | JEXL condition — step skipped when false                        |
| `timeoutSec`    | number                | Execution timeout in seconds                                    |
| `retries`       | number                | Retry attempts on transient failure                             |
| `retryDelayMs`  | number                | Delay between retries (default: 5000)                           |
| `allowFailure`  | boolean               | Continue pipeline if step fails                                 |
| `allowNetwork`  | boolean               | Enable network access in the container                          |

## Environment Variables

Env vars can come from multiple sources. Merge priority (highest wins):

1. Step `env` (inline YAML)
2. Step `envFile` (per-step dotenv file)
3. CLI `--env-file` (global, applied to all steps)
4. Kit defaults

## Mounts

Mount host directories read-only into containers:

```yaml
mounts:
  - host: src/app        # relative path (from pipeline file directory)
    container: /app      # absolute path in container
```

Rules: `host` must be relative (may use `..` to reach sibling directories, but cannot escape `process.cwd()`), `container` must be absolute and cannot contain `..`. Containers cannot modify mounted host files.

## Sources

Copy host directories into the container's writable layer:

```yaml
sources:
  - host: src/app
    container: /app
```

Same path rules as mounts (`host` may use `..` but cannot escape `process.cwd()`). Files are snapshotted at step start. The container can create files alongside sources (e.g. `node_modules`).

**When to use `sources` vs `mounts`**:
- `sources`: step needs to write alongside source files (install deps, generate build artifacts)
- `mounts`: read-only access is sufficient (config, static data)

## Caches

Persistent read-write directories shared across steps and executions:

```yaml
caches:
  - name: pnpm-store
    path: /root/.local/share/pnpm/store
  - name: build-cache
    path: /tmp/cache
```

Caches are workspace-scoped (not global). Common uses: package manager caches, build caches, downloaded assets.

## Conditional Steps

Use `if` with a [JEXL](https://github.com/TomFrost/Jexl) expression evaluated against environment variables via `env`:

```yaml
- id: deploy
  if: env.NODE_ENV == "production"
  uses: shell
  with:
    run: echo "Deploying..."

- id: notify
  if: env.CI
  uses: shell
  with:
    run: echo "Running in CI"
```

When a condition is false, the step is skipped. Steps with required (non-optional) inputs depending on a skipped step are also skipped.

## Caching and Workspaces

Workspace ID is determined by (in priority order):
1. `--workspace` CLI flag
2. Pipeline `id` (explicit or derived from `name`)

Steps are skipped when their fingerprint (SHA256 of image + cmd + resolved env including `envFile` and `--env-file` + sorted inputs + mounts) hasn't changed since the last successful run. Use `--force` to bypass.
