import 'fake-indexeddb/auto'
import { makeLocks } from './fixtures/locks.ts'

// The free test run must never reach OpenAI: any real request fails loudly.
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('api.openai.com') && !process.env.LIVE) {
    throw new Error(`Blocked network request in free test run: ${url}`)
  }
  return realFetch(input, init)
}) as typeof fetch

// happy-dom has no Web Locks: an exclusive lock manager like the browser's (specs/015-reader-book-container, R021).
// No application module is imported here: tests that mock a dependency (idb) must load the app modules themselves.
if (!(navigator as unknown as { locks?: unknown }).locks) {
  Object.defineProperty(navigator, 'locks', { value: makeLocks(), configurable: true })
}
