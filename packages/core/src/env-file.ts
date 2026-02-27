import {readFile} from 'node:fs/promises'
import {parse} from 'dotenv'

export async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
  const content = await readFile(filePath, 'utf8')
  return parse(content)
}
