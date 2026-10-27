// Compares the code with the sibling app (English Reader ↔ Polish Reader, specs/005-reliability → R0.3).
// Everything outside ALLOWED must be byte-identical, so a fix is copied between the apps unchanged.
// Usage: npm run sibling-diff [-- <path to the sibling repository>]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const here = resolve(import.meta.dirname, '..')
const name = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')).name
const sibling = resolve(here, process.argv[2] ?? (name.startsWith('english') ? '../Polish_Reader_Books_PWA' : '../English_Reader_Books_PWA'))
if (!existsSync(resolve(sibling, 'package.json'))) {
  console.error(`Не знайдено сусідній репозиторій: ${sibling}`)
  process.exit(2)
}

const ROOTS = ['src/', 'tests/', 'scripts/', 'public/']
const ROOT_FILES = ['package.json', 'tsconfig.json', 'eslint.config.js', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'index.html', '.gitignore']

/** Paths (or path prefixes ending in «/») that differ by design, with the reason. */
const ALLOWED = {
  'src/core/language.ts': 'мовний модуль',
  'tests/fixtures/language.ts': 'дані мови для спільних тестів',
  'tests/unit/language.test.ts': 'перевірки мовного модуля',
  'tests/live/ai.live.test.ts': 'живі тести мовою книжки',
  'tests/golden/': 'звірка з нативним імпортером (лише English Reader)',
  'public/demo.md': 'демо-книжка',
  'public/manifest.webmanifest': 'назва застосунку',
  'public/apple-touch-icon.png': 'піктограма',
  'public/icons/': 'піктограми',
  'package.json': 'назва; скрипт golden',
  'index.html': 'назва застосунку',
  'vite.config.ts': 'порти dev/preview',
  'vitest.config.ts': 'тести golden',
  'playwright.config.ts': 'порт e2e',
}

const allowed = (path) => Object.keys(ALLOWED).some((key) => (key.endsWith('/') ? path.startsWith(key) : path === key))

function files(repo) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' })
  return new Set(out.split('\n').filter((path) => path && (ROOTS.some((root) => path.startsWith(root)) || ROOT_FILES.includes(path))
    && existsSync(resolve(repo, path))))
}

const ours = files(here)
const theirs = files(sibling)
const problems = []
for (const path of [...new Set([...ours, ...theirs])].sort()) {
  if (allowed(path)) continue
  if (!theirs.has(path)) problems.push(`лише тут:     ${path}`)
  else if (!ours.has(path)) problems.push(`лише там:     ${path}`)
  else if (!readFileSync(resolve(here, path)).equals(readFileSync(resolve(sibling, path)))) problems.push(`відрізняється: ${path}`)
}

if (problems.length === 0) {
  console.log(`OK: код збігається з ${sibling}, крім дозволених відмінностей (${Object.keys(ALLOWED).length}).`)
  process.exit(0)
}
console.log(`Розбіжності з ${sibling} поза дозволеним списком:`)
for (const line of problems) console.log(`  ${line}`)
process.exit(1)
