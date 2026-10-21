import { signal } from '@preact/signals'

export type Route =
  | { screen: 'library' }
  | { screen: 'reader'; bookID: string }

export const route = signal<Route>({ screen: 'library' })

export const openBook = (bookID: string) => { route.value = { screen: 'reader', bookID } }
export const openLibrary = () => { route.value = { screen: 'library' } }
