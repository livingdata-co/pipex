import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {parse as parseYaml} from 'yaml'
import type {PipexConfig} from '@livingdata/pipex-core'

/**
 * Loads the project-level `.pipex.yml` configuration from a directory.
 * Returns an empty config when the file does not exist.
 */
export async function loadConfig(dir: string): Promise<PipexConfig> {
  let content: string
  try {
    content = await readFile(join(dir, '.pipex.yml'), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }

    throw error
  }

  const parsed = parseYaml(content) as unknown
  if (parsed === null || parsed === undefined) {
    return {}
  }

  return parsed as PipexConfig
}
