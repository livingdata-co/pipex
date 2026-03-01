import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {parse as parseYaml} from 'yaml'
import type {TyltConfig} from '@tylt/core'

/**
 * Loads the project-level `.tylt.yml` configuration from a directory.
 * Returns an empty config when the file does not exist.
 */
export async function loadConfig(dir: string): Promise<TyltConfig> {
  let content: string
  try {
    content = await readFile(join(dir, '.tylt.yml'), 'utf8')
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

  return parsed as TyltConfig
}
