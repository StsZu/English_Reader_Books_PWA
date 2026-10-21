import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

/** Emits sw.js with the list of built files to precache (no Workbox dependency). */
function serviceWorker(): Plugin {
  return {
    name: 'english-reader-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((name) => !name.endsWith('.map'))
      const precache = ['./', ...files, 'manifest.webmanifest', 'demo.md', 'apple-touch-icon.png',
        'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']
      const version = Date.now().toString(36)
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__VERSION__', version)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [preact(), serviceWorker()],
  define: {
    __TEST_MODE__: JSON.stringify(mode !== 'production'),
  },
  build: {
    outDir: mode === 'test' ? 'dist-test' : 'dist',
    target: 'safari16',
    sourcemap: false,
  },
}))
