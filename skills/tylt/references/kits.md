# Kits Reference

Kits are reusable step templates selected via `uses`. They generate image, command, setup phase, and mounts automatically. User-level `env`/`caches`/`mounts`/`sources`/`setup` merge with kit defaults (user values win).

Kits use a two-phase execution model: the **setup phase** handles dependency installation (with exclusive cache locking and network access), and the **run phase** executes the user command (parallel-safe, isolated). This prevents cache corruption when parallel steps share a package manager cache.

## shell

Run a shell command with optional apt packages.

| Parameter  | Default           | Description                                              |
|------------|-------------------|----------------------------------------------------------|
| `run`      | *(required)*      | Shell command to execute                                 |
| `packages` | --                | Apt packages to install before running                   |
| `src`      | --                | Host directory to mount read-only at `/app`              |
| `image`    | `alpine:3.20`    | Docker image (switches to `debian:bookworm-slim` when `packages` is set) |

Behavior:
- Without `packages`: alpine, no network access, no setup phase
- With `packages`: debian image, setup phase installs packages (with network and exclusive `apt-cache` cache), run phase executes the user command

```yaml
# Simple (alpine, no network)
- id: list
  uses: shell
  with:
    run: ls -lhR /input/data/

# With packages (debian, network + apt cache)
- id: extract
  uses: shell
  with:
    packages: [unzip, jq]
    run: unzip /input/download/data.zip -d /output/
  inputs: [{ step: download }]
```

## node

Run a Node.js command with automatic dependency installation.

| Parameter        | Default     | Description                           |
|------------------|-------------|---------------------------------------|
| `script`         | --          | Script to run (relative to `/app`). Mutually exclusive with `run`. |
| `run`            | --          | Arbitrary shell command. Mutually exclusive with `script`. |
| `src`            | --          | Host directory copied into `/app`     |
| `version`        | `"24"`      | Node.js version                       |
| `packageManager` | `"npm"`     | `"npm"`, `"pnpm"`, or `"yarn"`       |
| `install`        | `true`      | Run package install before command    |
| `variant`        | `"alpine"`  | Image variant                         |

Exactly one of `script` or `run` is required. `script: transform.js` is shorthand for `run: node /app/transform.js`. Use `run` to pass arguments or call any command available in the container.

When `install` is true (default), the install command runs in a setup phase with exclusive cache locking and network access. The user command runs in the parallel-safe run phase. The `src` directory is copied (not mounted) via `sources` so `node_modules` can be created alongside source files.

```yaml
# Simple script
- id: transform
  uses: node
  with:
    script: transform.js
    src: src/app
    version: "22"
    packageManager: pnpm

# Script with arguments
- id: convert
  uses: node
  with:
    run: node /app/convert.js --format csv --output /output/
    src: src/app
```

## python

Run a Python command with automatic dependency installation from `requirements.txt`.

| Parameter        | Default     | Description                           |
|------------------|-------------|---------------------------------------|
| `script`         | --          | Script to run (relative to `/app`). Mutually exclusive with `run`. |
| `run`            | --          | Arbitrary shell command. Mutually exclusive with `script`. |
| `src`            | --          | Host directory copied into `/app`     |
| `version`        | `"3.12"`    | Python version                        |
| `packageManager` | `"pip"`     | `"pip"` or `"uv"`                    |
| `install`        | `true`      | Run dependency install before command |
| `variant`        | `"slim"`    | Image variant                         |

Exactly one of `script` or `run` is required. `script: analyze.py` is shorthand for `run: python /app/analyze.py`. Use `run` to pass arguments or call any command available in the container.

When `install` is true (default), the install command runs in a setup phase with exclusive cache locking and network access. The user command runs in the parallel-safe run phase.

```yaml
# Simple script
- id: analyze
  uses: python
  with:
    script: analyze.py
    src: scripts/python
    version: "3.12"
    packageManager: uv

# Script with arguments
- id: enrich
  uses: python
  with:
    run: python /app/enrich.py --locale fr --input /input/analyze/
    src: scripts/python
  inputs: [{ step: analyze }]
```
