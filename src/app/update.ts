// Service worker registration and the «Доступна нова версія» offer (specs/007-version, V2).
// A new version installs in the background and waits; it takes over only after «Оновити» (or a full relaunch).
import { signal } from '@preact/signals'

/** Applies the waiting version; null while there is none. */
export const pendingUpdate = signal<(() => void) | null>(null)

/**
 * Offers a waiting service worker as an update (not the first install: then nothing controls the page yet),
 * checks for a new version whenever the app comes back to the foreground, and reloads once the new version
 * took over at the user's request.
 */
export function watchUpdates(
  registration: ServiceWorkerRegistration,
  container: ServiceWorkerContainer = navigator.serviceWorker,
  reload: () => void = () => location.reload(),
) {
  let requested = false
  let reloading = false

  const track = (worker: ServiceWorker | null) => {
    if (!worker) return
    const offer = () => {
      if (worker.state !== 'installed' || !container.controller) return
      pendingUpdate.value = () => {
        requested = true
        worker.postMessage('skipWaiting')
      }
    }
    offer()
    worker.addEventListener('statechange', offer)
  }

  track(registration.waiting)
  track(registration.installing)
  registration.addEventListener('updatefound', () => track(registration.installing))
  container.addEventListener('controllerchange', () => {
    if (!requested || reloading) return
    reloading = true
    reload()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {})
  })
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  navigator.serviceWorker.register('./sw.js').then((registration) => watchUpdates(registration)).catch(() => {})
}
