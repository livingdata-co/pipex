# @livingdata/pipex-kits

Built-in kit implementations for the Pipex pipeline engine.

Kits are reusable step templates that generate container configuration (image, commands, caches, mounts) from simple parameters. This package provides the three built-in kits: `shell`, `node`, and `python`.

## Installation

```bash
npm install @livingdata/pipex-kits
```

## Usage

```typescript
import {builtinKits} from '@livingdata/pipex-kits'
import type {KitContext} from '@livingdata/pipex-core'

const kitContext: KitContext = {
  config: {},
  cwd: process.cwd(),
  builtins: builtinKits
}
```

Individual kits are also exported: `shellKit`, `nodeKit`, `pythonKit`.

## Built-in Kits

All kits use a **two-phase execution model**: the `setup` phase handles dependency installation (with exclusive cache locking and network access), and the `cmd` phase runs the actual command (parallel-safe, isolated).

### `node`

Run a Node.js command with automatic dependency installation.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `script` | -- | Script to run (relative to `/app`). Mutually exclusive with `run`. |
| `run` | -- | Arbitrary shell command. Mutually exclusive with `script`. |
| `src` | -- | Host directory to copy into `/app` |
| `version` | `"24"` | Node.js version |
| `packageManager` | `"npm"` | `"npm"`, `"pnpm"`, or `"yarn"` |
| `install` | `true` | Run package install before command |
| `variant` | `"alpine"` | Image variant |

Exactly one of `script` or `run` is required. `script: transform.js` is shorthand for `run: node /app/transform.js`.

### `python`

Run a Python command with automatic dependency installation from `requirements.txt`.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `script` | -- | Script to run (relative to `/app`). Mutually exclusive with `run`. |
| `run` | -- | Arbitrary shell command. Mutually exclusive with `script`. |
| `src` | -- | Host directory to copy into `/app` |
| `version` | `"3.12"` | Python version |
| `packageManager` | `"pip"` | `"pip"` or `"uv"` |
| `install` | `true` | Run dependency install before command |
| `variant` | `"slim"` | Image variant |

Exactly one of `script` or `run` is required. `script: analyze.py` is shorthand for `run: python /app/analyze.py`.

### `shell`

Run a shell command in a container, with optional apt package installation.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `run` | *(required)* | Shell command to execute |
| `packages` | -- | Apt packages to install before running |
| `src` | -- | Host directory to mount read-only at `/app` |
| `image` | `"alpine:3.20"` | Docker image (defaults to `"debian:bookworm-slim"` when `packages` is set) |

When `packages` is provided, the kit switches to a Debian image and installs packages in a setup phase with network access. Without packages, it runs on Alpine with no network and no setup phase.

## Creating Custom Kits

This package also serves as an example for writing your own kits. A kit is a JavaScript (ESM) module that exports a default `resolve` function:

```js
// kits/rust.js
export default function resolve(params) {
  return {
    image: `rust:${params.version ?? '1'}`,
    cmd: ['cargo', 'run'],
    sources: params.src ? [{ host: params.src, container: '/app' }] : undefined,
  }
}
```

**Resolution order** when `uses: X` is encountered:

1. **Alias** — `.pipex.yml` `kits` mapping
2. **Local directory** — `kits/<name>/index.js`
3. **Local file** — `kits/<name>.js`
4. **Builtin** — `node`, `python`, `shell`
5. **npm module** — `import(name)` for scoped packages or paths containing `/`

### Directory kits with companion files

```
kits/
└── s3-loader/
    ├── index.js
    ├── loader.py
    └── requirements.txt
```

```js
export default function resolve(params, { kitDir }) {
  return {
    image: 'python:3.12-slim',
    cmd: ['python', '/app/loader.py'],
    sources: [{ host: kitDir, container: '/app' }]
  }
}
```

### Kit chaining

Compose another kit via `context.resolveKit()`:

```js
export default async function resolve(params, { kitDir, resolveKit }) {
  const python = await resolveKit('python')
  const base = await python.resolve({ version: '3.12', install: true })

  return {
    ...base,
    cmd: ['python', '/app/loader.py'],
    sources: [...(base.sources ?? []), { host: kitDir, container: '/app' }]
  }
}
```

### npm distribution

Kits can be distributed as npm packages and referenced via `.pipex.yml` aliases:

```yaml
# .pipex.yml
kits:
  s3-loader: "@myorg/kits-data/s3-loader"
```
