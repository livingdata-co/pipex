import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {dirname, join, resolve} from 'node:path'
import {KitError} from '../errors.js'
import type {PipexConfig, Step} from '../types.js'
import {nodeKit} from './builtin/node.js'
import {pythonKit} from './builtin/python.js'
import {shellKit} from './builtin/shell.js'

export type KitOutput = Omit<Step, 'id' | 'name' | 'inputs' | 'outputPath' | 'timeoutSec' | 'allowFailure'>

/** Context passed to kit resolve() for companion files and chaining. */
export type KitResolveContext = {
  /** Absolute path to the kit's directory (for referencing companion files). */
  kitDir: string;
  /** Resolve another kit by name (for kit chaining/composition). */
  resolveKit: (name: string) => Promise<Kit>;
}

export type Kit = {
  name: string;
  /** Absolute path to the kit's directory (set for external kits). */
  kitDir?: string;
  resolve(params: Record<string, unknown>, context?: KitResolveContext): KitOutput | Promise<KitOutput>;
}

/** Context for resolving user-defined kits. */
export type KitContext = {
  /** Project-level config (kit aliases). */
  config: PipexConfig;
  /** Working directory (used to locate `kits/` directory). */
  cwd: string;
}

const builtinKits = new Map<string, Kit>([
  [nodeKit.name, nodeKit],
  [pythonKit.name, pythonKit],
  [shellKit.name, shellKit]
])

/**
 * Resolves a kit by name.
 *
 * Resolution order (when context is provided):
 * 1. Alias — `context.config.kits[name]` → load external kit from the target
 * 2. Local file — `${context.cwd}/kits/${name}.js`
 * 3. Builtin — internal registry (node, python, shell)
 * 4. npm module — `import(name)` (only when name contains `/` or starts with `@`)
 *
 * Without context, only builtins are available.
 */
export async function resolveKit(name: string, context?: KitContext): Promise<Kit> {
  if (context) {
    // 1. Alias
    const alias = context.config.kits?.[name]
    if (alias) {
      return loadExternalKit(name, alias, context.cwd)
    }

    // 2. Local file in kits/ directory (directory with index.js takes precedence)
    const dirIndexPath = resolve(context.cwd, 'kits', name, 'index.js')
    try {
      return await loadExternalKit(name, dirIndexPath, context.cwd)
    } catch (error) {
      if (!(error instanceof KitError && error.code === 'KIT_LOAD_FAILED')) {
        throw error
      }

      // Fall through to flat file
    }

    const localPath = resolve(context.cwd, 'kits', `${name}.js`)
    try {
      return await loadExternalKit(name, localPath, context.cwd)
    } catch (error) {
      if (!(error instanceof KitError && error.code === 'KIT_LOAD_FAILED')) {
        throw error
      }

      // Fall through to builtins
    }

    // 3. Builtin
    const builtin = builtinKits.get(name)
    if (builtin) {
      return builtin
    }

    // 4. npm module (only for scoped packages or paths with /)
    if (name.includes('/') || name.startsWith('@')) {
      return loadExternalKit(name, name, context.cwd)
    }

    throw new KitError('UNKNOWN_KIT', `Unknown kit: "${name}". Available kits: ${[...builtinKits.keys()].join(', ')}`)
  }

  // No context — builtins only
  const builtin = builtinKits.get(name)
  if (!builtin) {
    throw new KitError('UNKNOWN_KIT', `Unknown kit: "${name}". Available kits: ${[...builtinKits.keys()].join(', ')}`)
  }

  return builtin
}

/**
 * Loads an external kit from a file path or npm module specifier.
 * Relative paths (./  ../) are resolved relative to basedir.
 * Sets `kitDir` to the directory containing the loaded file.
 */
async function loadExternalKit(name: string, specifier: string, basedir: string): Promise<Kit> {
  let mod: unknown
  let kitDir: string
  try {
    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      const absolutePath = specifier.startsWith('/') ? specifier : resolve(basedir, specifier)
      mod = await import(pathToFileURL(absolutePath).href) as unknown
      kitDir = dirname(absolutePath)
    } else {
      // Npm module — resolve the actual file path to get kitDir
      const require = createRequire(join(basedir, 'package.json'))
      kitDir = dirname(require.resolve(specifier))
      mod = await import(specifier) as unknown
    }
  } catch (error) {
    throw new KitError('KIT_LOAD_FAILED', `Failed to load kit "${name}" from "${specifier}"`, {cause: error})
  }

  const resolveFn = (mod as {default?: unknown}).default
  if (typeof resolveFn !== 'function') {
    throw new KitError('KIT_INVALID_EXPORT', `Kit "${name}" must export a default function, got ${typeof resolveFn}`)
  }

  return {name, kitDir, resolve: resolveFn as Kit['resolve']}
}
