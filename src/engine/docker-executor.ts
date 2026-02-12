import process from 'node:process'
import {execa} from 'execa'
import type {RunContainerRequest, RunContainerResult} from './types.js'
import {ContainerExecutor, type OnLogLine} from './executor.js'
import type {Workspace} from './workspace.js'

/**
 * Build a minimal environment for the Docker CLI process.
 * Only PATH, HOME, and DOCKER_* are kept — everything else is stripped
 * so that host secrets (API keys, tokens, credentials) never leak,
 * even if a `-e KEY` (without value) were accidentally added.
 */
function dockerCliEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (key === 'PATH' || key === 'HOME' || key.startsWith('DOCKER_'))) {
      env[key] = value
    }
  }

  return env
}

export class DockerCliExecutor extends ContainerExecutor {
  private readonly env = dockerCliEnv()

  async check(): Promise<void> {
    try {
      await execa('docker', ['--version'], {env: this.env})
    } catch {
      throw new Error('Docker CLI not found. Please install Docker.')
    }
  }

  async run(
    workspace: Workspace,
    request: RunContainerRequest,
    onLogLine: OnLogLine
  ): Promise<RunContainerResult> {
    const startedAt = new Date()
    const args = ['run', '--name', request.name, '--network', request.network]

    if (request.env) {
      for (const [key, value] of Object.entries(request.env)) {
        args.push('-e', `${key}=${value}`)
      }
    }

    // Mount inputs (committed artifacts, read-only)
    for (const input of request.inputs) {
      const hostPath = workspace.artifactPath(input.artifactId)
      args.push('-v', `${hostPath}:${input.containerPath}:ro`)
    }

    // Mount caches (persistent, read-write)
    if (request.caches) {
      for (const cache of request.caches) {
        const hostPath = workspace.cachePath(cache.name)
        args.push('-v', `${hostPath}:${cache.containerPath}:rw`)
      }
    }

    // Mount host bind mounts (always read-only)
    if (request.mounts) {
      for (const mount of request.mounts) {
        args.push('-v', `${mount.hostPath}:${mount.containerPath}:ro`)
      }
    }

    // Shadow paths: anonymous volumes that mask read-only mounts
    if (request.shadowPaths) {
      for (const path of request.shadowPaths) {
        args.push('--mount', `type=volume,dst=${path}`)
      }
    }

    // Mount output (staging artifact, read-write)
    const outputHostPath = workspace.stagingPath(request.output.stagingArtifactId)
    args.push('-v', `${outputHostPath}:${request.output.containerPath}:rw`, request.image, ...request.cmd)

    let exitCode = 0
    let error: string | undefined

    try {
      const proc = execa('docker', args, {
        env: this.env,
        reject: false,
        timeout: request.timeoutSec ? request.timeoutSec * 1000 : undefined
      })

      const stdoutDone = (async () => {
        for await (const line of proc.iterable({from: 'stdout'})) {
          onLogLine({stream: 'stdout', line})
        }
      })()

      const stderrDone = (async () => {
        for await (const line of proc.iterable({from: 'stderr'})) {
          onLogLine({stream: 'stderr', line})
        }
      })()

      const result = await proc
      await Promise.all([stdoutDone, stderrDone])
      exitCode = result.exitCode ?? 0
    } catch (error_) {
      exitCode = 1
      error = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      try {
        await execa('docker', ['rm', '-f', '-v', request.name], {env: this.env, reject: false})
      } catch {
        // Best effort cleanup
      }
    }

    return {exitCode, startedAt, finishedAt: new Date(), error}
  }
}
