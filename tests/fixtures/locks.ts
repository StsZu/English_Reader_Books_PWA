// A small exclusive lock manager for unit tests (happy-dom has no Web Locks): requests of one name run one after another.
export function makeLocks() {
  const tails = new Map<string, Promise<unknown>>()
  return {
    async request<T>(name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> {
      const before = tails.get(name) ?? Promise.resolve()
      let release!: () => void
      const mine = new Promise<void>((resolve) => { release = resolve })
      tails.set(name, before.then(() => mine))
      await before.catch(() => {})
      try {
        return await callback()
      } finally {
        release()
      }
    },
  }
}
