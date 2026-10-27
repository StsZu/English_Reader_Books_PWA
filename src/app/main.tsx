import { render } from 'preact'
import { App } from './App.tsx'
import { registerServiceWorker } from './update.ts'
import '../ui/theme/tokens.css'

render(<App />, document.getElementById('app')!)

registerServiceWorker()
