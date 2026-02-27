import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {dirname, join, resolve} from 'node:path'
import {KitError} from './errors.js'
import {defaultKits} from './kits/index.js'
import type {Kit, KitContext} from './types.js'

/**
 * Resolves a kit by name.
 *
 * Resolution order (when context is provided):
 * 1. Alias — `context.config.kits[name]` → load external kit from the target
 * 2. Local directory — `${context.cwd}/kits/${name}/index.js`
 * 3. Local file — `${context.cwd}/kits/${name}.js`
 * 4. Custom kits — `context.kits` (user-provided kits)
 * 5. Builtin — `defaultKits` (always available)
 * 6. npm module — `import(name)` (only when name contains `/` or starts with `@`)
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

      // Fall through to custom kits
    }

    // 3. Custom kits from context
    const custom = context.kits?.get(name)
    if (custom) {
      return custom
    }
  }

  // 4. Builtin (always available, no context needed)
  const builtin = defaultKits.get(name)
  if (builtin) {
    return builtin
  }

  if (context) {
    // 5. npm module (only for scoped packages or paths with /)
    if (name.includes('/') || name.startsWith('@')) {
      return loadExternalKit(name, name, context.cwd)
    }

    const available = [...defaultKits.keys(), ...(context.kits ? [...context.kits.keys()] : [])].join(', ')
    throw new KitError('UNKNOWN_KIT', `Unknown kit: "${name}". Available kits: ${available}`)
  }

  // No context — only builtins were checked
  throw new KitError('UNKNOWN_KIT', `Unknown kit: "${name}". Available kits: ${[...defaultKits.keys()].join(', ')}`)
}

/**
 * Loads an external kit from a file path or npm module specifier.
 * Relative paths (./  ../) are resolved relative to basedir.
 * Sets `kitDir` to the directory containing the loaded file.
 */
export async function loadExternalKit(name: string, specifier: string, basedir: string): Promise<Kit> {
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
