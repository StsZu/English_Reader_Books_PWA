import { route } from './router.ts'

export function App() {
  const current = route.value
  return (
    <main>
      {current.screen === 'library' && <h1>Мої книжки</h1>}
    </main>
  )
}
