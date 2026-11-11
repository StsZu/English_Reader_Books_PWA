// Service worker (src/sw-template.js) in a fake worker scope: caches, fetch and events.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Listener = (event: { request: Request; respondWith(response: Promise<Response>): void }) => void

function worker(version: string, network: () => Promise<Response>, precache: string[] = ['./']) {
  const stores = new Map<string, Map<string, Response>>()
  /** Options of every `caches.match` call, by URL. */
  const matched = new Map<string, unknown>()
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        put: async (key: string, response: Response) => { store.set(key, response) },
        addAll: async (keys: string[]) => { for (const key of keys) store.set(key, new Response(`${version}:${key}`)) },
      }
    },
    async match(key: string | Request, options?: unknown) {
      if (typeof key !== 'string') {
        matched.set(key.url, options)
        const url = new URL(key.url)
        if (url.search) return undefined // as Cache.match without ignoreSearch
        key = url.pathname.replace(/^\//, '') || './'
      }
      for (const store of stores.values()) if (store.has(key)) return store.get(key)!.clone()
      return undefined
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  }
  const listeners = new Map<string, Listener>()
  const self = {
    location: { origin: 'https://app.test' }, registration: { scope: 'https://app.test/' },
    addEventListener: (type: string, f: Listener) => listeners.set(type, f),
  }
  const source = readFileSync('src/sw-template.js', 'utf8').replace('__PRECACHE__', JSON.stringify(precache)).replace('__VERSION__', version)
  new Function('self', 'caches', 'fetch', source)(self, caches, network)
  return {
    stores,
    matched,
    async get(url: string): Promise<string> {
      const answer: { response?: Promise<Response> } = {}
      listeners.get('fetch')!({ request: { method: 'GET', mode: 'cors', url } as Request, respondWith: (r) => { answer.response = r } })
      if (!answer.response) throw new Error('the worker did not answer')
      return (await answer.response).text()
    },
    async install() {
      let wait: Promise<unknown> = Promise.resolve()
      listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => { wait = p } } as never)
      await wait
    },
    async navigate(): Promise<string> {
      const answer: { response?: Promise<Response> } = {}
      listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://app.test/' } as Request, respondWith: (r) => { answer.response = r } })
      if (!answer.response) throw new Error('the worker did not answer')
      return (await answer.response).text()
    },
  }
}

describe('service worker (R8)', () => {
  it('a page of a newer version from the network does not replace the cached page of this version', async () => {
    let online = true
    const sw = worker('A', async () => {
      if (!online) throw new TypeError('offline')
      return new Response('B:page')
    })
    await sw.install()
    expect(await sw.navigate()).toBe('B:page')
    online = false
    expect(await sw.navigate()).toBe('A:./')
  })
})

describe('service worker: files of the shell and `Vary` (S9)', () => {
  it('matches the precached files of this build without regard to Vary, and nothing else', async () => {
    const sw = worker('A', async () => new Response('network'), ['./', 'assets/index-abc.js'])
    await sw.install()
    expect(await sw.get('https://app.test/assets/index-abc.js')).toBe('A:assets/index-abc.js')
    expect(sw.matched.get('https://app.test/assets/index-abc.js')).toEqual({ ignoreVary: true })
    expect(await sw.get('https://app.test/assets/other.js')).toBe('network')
    expect(sw.matched.get('https://app.test/assets/other.js')).toBeUndefined()
    expect(await sw.get('https://app.test/assets/index-abc.js?x=1')).toBe('network')
    expect(sw.matched.get('https://app.test/assets/index-abc.js?x=1')).toBeUndefined()
  })
})
