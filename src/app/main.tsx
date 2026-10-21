import { render } from 'preact'
import { App } from './App.tsx'
import '../ui/theme/tokens.css'

render(<App />, document.getElementById('app')!)

if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}
