# Pipex

Containerized pipeline execution engine. Each step runs in an isolated Docker container with explicit inputs, outputs, and caching.

```yaml
name: data-pipeline
steps:
  - id: download
    uses: shell
    with:
      packages: [curl]
      run: curl -o /output/data.csv https://example.com/data.csv

  - id: analyze
    uses: python
    with: { script: analyze.py, src: scripts/ }
    inputs: [{ step: download }]

  - id: report
    uses: node
    with: { script: report.js, src: app/ }
    inputs: [{ step: analyze }]
```

```bash
npx @livingdata/pipex run
```

## Features

- 🐳 **Container isolation** — Every step runs in its own Docker container with controlled network access
- 🔀 **DAG execution** — Steps declare dependencies via `inputs`; independent steps run in parallel
- ⚡ **Fingerprint caching** — Steps are skipped when image, command, env, and inputs haven't changed
- 🧰 **Built-in kits** — `node`, `python`, `shell` with automatic dependency installation
- 🔒 **Two-phase execution** — Setup (install deps with network + cache locks) then run (isolated, parallel-safe)
- 🔌 **Custom kits** — Write your own as JS modules, distribute via npm
- 📦 **Artifact management** — Immutable runs with artifacts, logs, and structured metadata
- 🛠️ **Programmatic API** — Use `@livingdata/pipex-core` to embed pipeline execution in your own tools

## Quick Start

```bash
npx @livingdata/pipex run pipeline.yaml
```

Or install globally:

```bash
npm install -g @livingdata/pipex
pipex run pipeline.yaml
```

## Packages

This is a monorepo with two packages:

| Package | npm | Description |
|---------|-----|-------------|
| [`@livingdata/pipex`](packages/cli/) | CLI | Command-line interface, interactive reporter |
| [`@livingdata/pipex-core`](packages/core/) | Library | Programmatic TypeScript API: engine, orchestration, built-in kits, types |

## Custom Kits

Write reusable step templates as JS modules, reference them via `uses`. Configure aliases in `.pipex.yml`:

```yaml
# .pipex.yml
kits:
  geo: ./kits/geo.js
  ml: @myorg/pipex-kit-ml
```

See the [CLI README](packages/cli/README.md#custom-kits) for details on writing kits and resolution order.

## Examples

```bash
# Geodata: download → extract → list-files / build-csv (parallel)
pipex run examples/geodata/

# Text processing: parallel branches, conditional steps, optional inputs
pipex run examples/text-processing/

# Multi-language: Node.js + Python steps with automatic dependency install
pipex run examples/multi-language/
```

## Development

```bash
git clone https://github.com/livingdata-co/pipex.git
cd pipex
npm install
```

```bash
npm run cli -- run pipeline.yaml   # Dev mode (tsx, no build needed)
npm run build                      # Compile all packages (tsc --build)
npm test                           # Run tests across all packages
npm run lint                       # Lint with XO
```
