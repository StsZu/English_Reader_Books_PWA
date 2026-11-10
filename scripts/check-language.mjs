// The production build in dist/ belongs to one app only (specs/014-shared-core, S6): its title and storage names,
// none of the other app's. Usage: APP_LANG=pl node scripts/check-language.mjs (en by default).
import { readdirSync, readFileSync } from 'node:fs'

const apps = {
  en: { title: 'English Reader', database: 'english-reader' },
  pl: { title: 'Polish Reader', database: 'polish-reader' },
}
const language = process.env.APP_LANG ?? 'en'
const own = apps[language]
const other = apps[language === 'en' ? 'pl' : 'en']
const problems = []

const html = readFileSync('dist/index.html', 'utf8')
if (!html.includes(`<title>${own.title}</title>`)) problems.push(`index.html: немає заголовка «${own.title}»`)
const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'))
if (manifest.name !== own.title) problems.push(`manifest.webmanifest: «${manifest.name}» замість «${own.title}»`)
const scripts = readdirSync('dist/assets').filter((name) => name.endsWith('.js')).map((name) => readFileSync(`dist/assets/${name}`, 'utf8')).join('\n')
if (!scripts.includes(`"${own.database}"`) && !scripts.includes(`'${own.database}'`)) problems.push(`у JS немає бази «${own.database}»`)
for (const text of [other.title, other.database]) {
  if (scripts.includes(text) || html.includes(text)) problems.push(`у збірці є «${text}» іншого застосунку`)
}

if (problems.length) {
  for (const problem of problems) console.log(`FAIL: ${problem}`)
  process.exit(1)
}
console.log(`OK: збірка ${own.title} (${language})`)
