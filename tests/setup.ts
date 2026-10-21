import 'fake-indexeddb/auto'

// The free test run must never reach OpenAI: any real request fails loudly.
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('api.openai.com') && !process.env.LIVE) {
    throw new Error(`Blocked network request in free test run: ${url}`)
  }
  return realFetch(input, init)
}) as typeof fetch
