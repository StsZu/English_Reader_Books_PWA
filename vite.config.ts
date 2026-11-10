import { execSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { formatBuildVersion } from './src/core/util/format.ts'
import { appLanguage, appTitle, ports } from './languages/app-language.ts'

/** English Reader or Polish Reader (specs/014-shared-core). */
const language = appLanguage()
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

/** Short commit hash: the Cloudflare build variable, otherwise git; null when neither is available. */
function commit(): string | null {
  const sha = process.env.WORKERS_CI_COMMIT_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

/** One version for the app and the service worker cache (specs/007-version, V1). */
const appVersion = formatBuildVersion(new Date(), commit())

/** Emits sw.js with the list of built files to precache (no Workbox dependency). */
function serviceWorker(): Plugin {
  return {
    name: 'english-reader-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((name) => !name.endsWith('.map'))
      const precache = ['./', ...files, 'manifest.webmanifest', 'demo.md', 'apple-touch-icon.png',
        'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__VERSION__', appVersion)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

/** The shared `public/` with the files of the language on top (demo book, manifest, icons), in `build/public-<lang>`. */
function publicDir(): string {
  const dir = path(`./build/public-${language}`)
  rmSync(dir, { recursive: true, force: true })
  cpSync(path('./public'), dir, { recursive: true })
  cpSync(path(`./languages/${language}/public`), dir, { recursive: true })
  return dir
}

/** The app name in index.html. */
function appName(): Plugin {
  const name = appTitle(language)
  return { name: 'app-name', transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', name) }
}

export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: publicDir(),
  plugins: [preact(), serviceWorker(), appName()],
  resolve: { alias: { '#language': path(`./src/languages/${language}.ts`) } },
  server: { port: ports[language].dev },
  preview: { port: ports[language].preview },
  define: {
    __TEST_MODE__: JSON.stringify(mode !== 'production'),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: mode === 'test' ? 'dist-test' : 'dist',
    target: 'safari16',
    sourcemap: false,
  },
}))
