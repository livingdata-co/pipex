/**
 * In-memory async mutex for cache names.
 *
 * Prevents concurrent setup phases from writing to the same cache directory.
 * Locks are acquired in sorted order to prevent deadlocks when a step
 * needs multiple caches.
 */
export class CacheLockManager {
  private readonly locks = new Map<string, Promise<void>>()
  private readonly resolvers = new Map<string, () => void>()

  /**
   * Acquire exclusive locks on the given cache names.
   * Returns an idempotent release function.
   *
   * Names are sorted before acquisition to prevent deadlocks.
   */
  async acquire(names: string[]): Promise<() => void> {
    const sorted = [...names].sort()
    for (const name of sorted) {
      while (this.locks.has(name)) {
        await this.locks.get(name)
      }

      let resolve!: () => void
      // eslint-disable-next-line promise/param-names
      const promise = new Promise<void>(r => {
        resolve = r
      })
      this.locks.set(name, promise)
      this.resolvers.set(name, resolve)
    }

    let released = false
    return () => {
      if (released) {
        return
      }

      released = true
      for (const name of sorted) {
        const resolve = this.resolvers.get(name)
        this.locks.delete(name)
        this.resolvers.delete(name)
        resolve?.()
      }
    }
  }
}
