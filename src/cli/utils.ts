import process from 'node:process'
import {access, stat} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import type {Command} from 'commander'

export type GlobalOptions = {
  workdir: string;
  json?: boolean;
}

export function getGlobalOptions(cmd: Command): GlobalOptions {
  return cmd.optsWithGlobals<GlobalOptions>()
}

const pipelineFilenames = ['pipeline.yml', 'pipeline.yaml', 'pipeline.json']

export async function resolvePipelineFile(pathOrDir?: string): Promise<string> {
  const target = resolve(pathOrDir ?? process.cwd())

  try {
    const stats = await stat(target)
    if (stats.isFile()) {
      return target
    }
  } catch {
    throw new Error(`Path does not exist: ${target}`)
  }

  for (const filename of pipelineFilenames) {
    const candidate = join(target, filename)
    try {
      await access(candidate)
      return candidate
    } catch {}
  }

  throw new Error(
    `No pipeline file found in ${target}. Expected one of: ${pipelineFilenames.join(', ')}`
  )
}
