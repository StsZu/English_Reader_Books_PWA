import { signal } from '@preact/signals'

export type Route =
  | { screen: 'library' }
  | { screen: 'reader'; bookID: string }

export const route = signal<Route>({ screen: 'library' })

export const openBook = (bookID: string) => { route.value = { screen: 'reader', bookID } }
export const openLibrary = () => { route.value = { screen: 'library' } }

/** Full-screen training over any screen (T1); opened from the saved list. */
export const trainingOpen = signal(false)
export const openTraining = () => { trainingOpen.value = true }
export const closeTraining = () => { trainingOpen.value = false }

/** «ШІ-сервіси» sheet; `onClose` callbacks retry failed requests (ReaderView .sheet onDismiss). */
export const aiServicesOpen = signal(false)
