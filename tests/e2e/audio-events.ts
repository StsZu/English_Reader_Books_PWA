// Journal of the events of every `new Audio()` of the page, with times (R026 investigation): written beside the test's
// other output as audio-events.log, passed or failed, so a failure that does not come back can still be read.
import { writeFileSync } from 'node:fs'
import type { TestType, PlaywrightTestArgs, PlaywrightTestOptions, PlaywrightWorkerArgs, PlaywrightWorkerOptions } from '@playwright/test'

type Test = TestType<PlaywrightTestArgs & PlaywrightTestOptions, PlaywrightWorkerArgs & PlaywrightWorkerOptions>

const EVENTS = ['loadstart', 'loadedmetadata', 'loadeddata', 'durationchange', 'canplay', 'canplaythrough', 'play', 'playing',
  'pause', 'seeking', 'seeked', 'ratechange', 'ended', 'error', 'stalled', 'suspend', 'abort', 'emptied', 'waiting']

export function recordAudioEvents(test: Test) {
  let lines: string[] = []
  let start = 0
  test.beforeEach(async ({ page }) => {
    lines = []
    start = Date.now()
    const at = () => `${String(Date.now() - start).padStart(6)}ms`
    page.on('console', (m) => { if (m.text().startsWith('AUDIO ')) lines.push(`${at()} ${m.text().slice(6)}`) })
    page.on('pageerror', (e) => lines.push(`${at()} PAGEERROR ${e.message}`))
    page.on('crash', () => lines.push(`${at()} CRASH`))
    await page.addInitScript((names: string[]) => {
      let count = 0
      const Original = window.Audio
      const Listened = function (src?: string) {
        const element = new Original(src)
        const id = ++count
        for (const name of names) {
          element.addEventListener(name, () => console.log('AUDIO ' + JSON.stringify({
            id, ev: name, src: element.currentSrc.slice(-12), duration: String(element.duration), ready: element.readyState,
            network: element.networkState, paused: element.paused, rate: element.playbackRate,
            time: Math.round(element.currentTime * 100) / 100, error: element.error?.code ?? null,
          })))
        }
        return element
      } as unknown as typeof Audio
      Listened.prototype = Original.prototype
      window.Audio = Listened
    }, EVENTS)
  })
  test.afterEach(async ({}, info) => {
    lines.push(`${String(Date.now() - start).padStart(6)}ms END ${info.status} (${info.duration} ms)`)
    writeFileSync(info.outputPath('audio-events.log'), `${lines.join('\n')}\n`)
  })
}
