// When the reader's keyboard shortcuts act (specs/003-resume-and-shortcuts).
import { signal } from '@preact/signals'
import { afterEach, describe, expect, it } from 'vitest'
import { readerShortcut } from '../../src/ui/reader/shortcuts.ts'
import type { ReaderModel } from '../../src/ui/reader/model.ts'

function fakeModel(audio: boolean) {
  const calls: string[] = []
  const model = {
    audioMode: audio,
    activeSentence: signal(null),
    audiobook: {
      hasAudio: audio,
      track: signal(0),
      skip: (s: number) => calls.push(`skip ${s}`),
      selectTrack: async (i: number) => { calls.push(`track ${i}`) },
    },
    toggleListening: () => calls.push('toggle'),
    stepRate: (d: number) => calls.push(`rate ${d}`),
    switchBarMode: () => calls.push('mode'),
    speakActiveSentence: () => calls.push('speak'),
  }
  return { model: model as unknown as ReaderModel, calls }
}

const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { code, key: code, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

afterEach(() => { document.body.innerHTML = '' })

describe('reader shortcuts', () => {
  it('play, skip, tracks, speed and mode in the audiobook', () => {
    const { model, calls } = fakeModel(true)
    for (const event of [key('Space'), key('ArrowLeft'), key('ArrowRight', { shiftKey: true }), key('Period'), key('Comma'),
      key('BracketLeft'), key('BracketRight'), key('KeyA')]) readerShortcut(event, model, () => {})?.()
    expect(calls).toEqual(['toggle', 'skip -5', 'skip 30', 'track 1', 'track -1', 'rate -1', 'rate 1', 'mode'])
  })

  it('in voice mode only Space acts; arrows keep scrolling the text', () => {
    const { model } = fakeModel(false)
    expect(readerShortcut(key('Space'), model, () => {})).not.toBeNull()
    for (const code of ['ArrowLeft', 'ArrowRight', 'Period', 'BracketRight', 'KeyA', 'Enter']) {
      expect(readerShortcut(key(code), model, () => {})).toBeNull()
    }
  })

  it('never with ⌘ / Ctrl / Alt, in a text field or over a sheet, dialog or menu', () => {
    const { model } = fakeModel(true)
    expect(readerShortcut(key('Space', { metaKey: true }), model, () => {})).toBeNull()
    expect(readerShortcut(key('KeyA', { ctrlKey: true }), model, () => {})).toBeNull()
    expect(readerShortcut(key('Space'), model, () => {})).not.toBeNull()
    expect(readerShortcut(key('Space', {}, document.createElement('input')), model, () => {})).toBeNull()
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    expect(readerShortcut(key('Space'), model, () => {})).toBeNull()
    document.body.innerHTML = '<div role="menu"></div>'
    expect(readerShortcut(key('ArrowLeft'), model, () => {})).toBeNull()
  })

  it('Enter speaks the selected sentence unless a button has the focus; «?» opens the list', () => {
    const { model, calls } = fakeModel(true)
    let help = 0
    expect(readerShortcut(key('Enter'), model, () => {})).toBeNull()
    ;(model.activeSentence as unknown as { value: unknown }).value = { paragraph: { chapter: 0, paragraph: 0 }, sentence: 0 }
    readerShortcut(key('Enter'), model, () => {})?.()
    expect(calls).toEqual(['speak'])
    expect(readerShortcut(key('Enter', {}, document.createElement('button')), model, () => {})).toBeNull()
    readerShortcut(key('Slash', { shiftKey: true }), model, () => { help++ })?.()
    expect(readerShortcut(key('Slash'), model, () => { help++ })).toBeNull()
    expect(help).toBe(1)
  })
})
