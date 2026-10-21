// Port of EnglishReader/Services/APIKeyStore.swift. The key lives in this origin's IndexedDB
// (no Keychain on the web, deviation V-03) with a synchronous in-memory copy for request code.
import { signal } from '@preact/signals'
import { testFlags } from '../../app/test-mode.ts'
import { deleteValue, getValue, setValue } from './db.ts'

const KEY = 'openaiKey'

let stored: string | null = null

/** True when a key was saved by the user (not counting the live-test key). */
export const hasStoredKey = signal(false)

/** Loads the saved key into memory; call once at startup. */
export async function initKey(): Promise<void> {
  const value = await getValue<string>('meta', KEY)
  stored = typeof value === 'string' && value.trim() ? value : null
  hasStoredKey.value = stored !== null
}

/** The key for requests: the live-test key first (like the env variable in Swift), then the saved one. */
export function openAIKey(): string | null {
  const test = testFlags.key?.trim()
  if (test) return test
  return stored
}

export async function saveKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) return deleteKey()
  await setValue('meta', KEY, trimmed)
  stored = trimmed
  hasStoredKey.value = true
}

export async function deleteKey(): Promise<void> {
  await deleteValue('meta', KEY)
  stored = null
  hasStoredKey.value = false
}
