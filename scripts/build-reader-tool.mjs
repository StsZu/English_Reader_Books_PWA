// Builds the versioned reader tool (scripts/reader-tool.ts) for both languages and publishes them as one package
// (specs/013-prepared-book, D2c). Each build goes to its own staging folder; the finished folder becomes
// build/reader-tool/versions/<id>/ and only then build/reader-tool/manifest.json is replaced by one rename, so a reader
// of the manifest sees either the whole old package or the whole new one, also when two builds run at once.
// The converter checks the manifest's protocol and the SHA-256 of each file against its own pin before it runs one.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const root = 'build/reader-tool'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const dirty = git('status', '--porcelain', '--', 'src', 'scripts', 'package.json', 'package-lock.json') !== ''
const commit = `${git('rev-parse', '--short', 'HEAD')}${dirty ? '+changed' : ''}`
const protocol = Number(/TOOL_PROTOCOL = (\d+)/.exec(readFileSync('scripts/reader-tool.ts', 'utf8'))[1])

mkdirSync(`${root}/versions`, { recursive: true })
const staging = `${root}/.staging-${randomUUID()}`
mkdirSync(staging)
try {
  const hashes = {}
  for (const language of ['en', 'pl']) {
    await build({
      entryPoints: ['scripts/reader-tool.ts'], bundle: true, platform: 'node', format: 'esm',
      outfile: `${staging}/reader-book-${language}.mjs`, logLevel: 'warning',
      alias: { '#language': `./src/languages/${language}.ts` },
      define: { __TEST_MODE__: 'false', __TOOL_COMMIT__: JSON.stringify(commit) },
    })
    hashes[language] = createHash('sha256').update(readFileSync(`${staging}/reader-book-${language}.mjs`)).digest('hex')
  }
  // The same files always get the same folder: a repeated build publishes nothing new.
  const id = createHash('sha256').update(JSON.stringify({ protocol, hashes })).digest('hex').slice(0, 16)
  const folder = `versions/${id}`
  const tools = Object.fromEntries(Object.entries(hashes).map(([language, sha256]) => [language, { file: `${folder}/reader-book-${language}.mjs`, sha256 }]))
  const manifest = { tool: 'reader-book', protocol, commit, version: id, tools }
  writeFileSync(`${staging}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  if (!existsSync(`${root}/${folder}`)) {
    try {
      renameSync(staging, `${root}/${folder}`)
    } catch (error) {
      if (!existsSync(`${root}/${folder}`)) throw error // another build published the same files first
    }
  }
  const pointer = `${root}/.manifest-${randomUUID()}.json`
  writeFileSync(pointer, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(pointer, `${root}/manifest.json`)
  console.log(JSON.stringify(manifest, null, 2))
} finally {
  rmSync(staging, { recursive: true, force: true })
}
