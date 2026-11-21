// scripts/check-secrets.sh (SC-12) on a throwaway git repository: a file it cannot read fails the check (audit 2026-11-20).
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let repo: string

const git = (...args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
const check = () => spawnSync('sh', [join(repo, 'scripts/check-secrets.sh')], { cwd: repo, encoding: 'utf8' })

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'check-secrets-'))
  mkdirSync(join(repo, 'scripts'))
  copyFileSync('scripts/check-secrets.sh', join(repo, 'scripts/check-secrets.sh'))
  writeFileSync(join(repo, 'a.txt'), 'plain text\n')
  writeFileSync(join(repo, 'b.txt'), 'more text\n')
  git('init', '-q')
  git('add', '.')
})

afterEach(() => {
  chmodSync(join(repo, 'b.txt'), 0o644)
  rmSync(repo, { recursive: true, force: true })
})

describe('check-secrets.sh', () => {
  it('чисті файли — OK; файл, видалений з робочої теки, не заважає', () => {
    const clean = check()
    expect(clean.status).toBe(0)
    expect(clean.stdout).toContain('OK:')
    unlinkSync(join(repo, 'a.txt'))
    expect(check().status).toBe(0)
  })

  it('рядок, схожий на ключ, — FAIL', () => {
    writeFileSync(join(repo, 'a.txt'), `key = sk-${'x'.repeat(20)}\n`)
    const result = check()
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('FAIL: схожий на ключ OpenAI')
  })

  it.skipIf(process.getuid?.() === 0)('файл, який не читається, — FAIL, а не OK', () => {
    chmodSync(join(repo, 'b.txt'), 0o000)
    const result = check()
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('FAIL: не всі файли вдалося прочитати')
    expect(result.stdout).not.toContain('OK:')
  })
})
