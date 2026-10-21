// Port of EnglishReader/Services/PronunciationRecorder.swift on getUserMedia + MediaRecorder.
// Recordings stay in memory (Blob URLs) until the end of the training and are never uploaded.
import { testFlags } from '../../app/test-mode.ts'

export type RecorderErrorKind = 'noMicrophone' | 'denied' | 'failed'

export class RecorderError extends Error {
  constructor(readonly kind: RecorderErrorKind) {
    super(recorderErrorText(kind))
    this.name = 'RecorderError'
  }
}

export function recorderErrorText(kind: RecorderErrorKind): string {
  switch (kind) {
    case 'noMicrophone': return 'На цьому iPad немає мікрофона — вправу «Вимова» можна пропустити.'
    case 'denied': return 'Немає дозволу на мікрофон. Дозвольте його в налаштуваннях Safari для цього сайту або пропустіть вправу.'
    case 'failed': return 'Не вдалося записати вимову. Спробуйте ще раз або пропустіть вправу.'
  }
}

/** Silent 16-bit mono PCM WAV (the analogue of SpeechFixture.silentWAV). */
export function silentWAV(seconds: number, sampleRate = 8000): Uint8Array {
  const samples = Math.floor(sampleRate * seconds)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples * 2, true)
  return new Uint8Array(buffer)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class PronunciationRecorder {
  private urls: string[] = []
  private stream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null
  private player: HTMLAudioElement | null = null
  private finishPlayback: (() => void) | null = null
  lastRecording: string | null = null

  static get isFixture(): boolean {
    return __TEST_MODE__ && testFlags.recording
  }

  static get hasMicrophone(): boolean {
    return PronunciationRecorder.isFixture || (typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  }

  /** Asks for the microphone; the stream is released at once (it is reopened for each recording). */
  async requestPermission(): Promise<void> {
    if (PronunciationRecorder.isFixture) return
    if (!PronunciationRecorder.hasMicrophone) throw new RecorderError('noMicrophone')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch (error) {
      const name = (error as { name?: string }).name
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new RecorderError('noMicrophone')
      throw new RecorderError('denied')
    }
  }

  /** Records for `duration` seconds and returns a Blob URL of the recording. */
  async record(duration: number): Promise<string> {
    this.stop()
    if (PronunciationRecorder.isFixture) {
      await sleep(duration * 1000)
      return this.keep(new Blob([silentWAV(duration) as BlobPart], { type: 'audio/wav' }))
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const name = (error as { name?: string }).name
      throw new RecorderError(name === 'NotFoundError' ? 'noMicrophone' : 'denied')
    }
    this.stream = stream
    try {
      const type = typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      this.mediaRecorder = recorder
      const chunks: Blob[] = []
      const done = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || type || 'audio/mp4' }))
        recorder.onerror = () => reject(new RecorderError('failed'))
      })
      recorder.start()
      await sleep((duration + 0.15) * 1000)
      if (recorder.state !== 'inactive') recorder.stop()
      const blob = await done
      if (!blob.size) throw new RecorderError('failed')
      return this.keep(blob)
    } catch (error) {
      throw error instanceof RecorderError ? error : new RecorderError('failed')
    } finally {
      this.releaseStream()
    }
  }

  private keep(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    this.urls.push(url)
    this.lastRecording = url
    return url
  }

  /** Stops microphone tracks at once so playback is routed to the speaker again. */
  private releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.mediaRecorder = null
  }

  async playLastRecording(): Promise<void> {
    const url = this.lastRecording
    if (!url) return
    this.stopPlayback()
    const player = new Audio(url)
    this.player = player
    await new Promise<void>((resolve) => {
      this.finishPlayback = resolve
      player.onended = () => this.endPlayback()
      player.onerror = () => this.endPlayback()
      player.play().catch(() => this.endPlayback())
    })
  }

  private endPlayback() {
    const finish = this.finishPlayback
    this.finishPlayback = null
    finish?.()
  }

  private stopPlayback() {
    this.player?.pause()
    this.player = null
    this.endPlayback()
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop()
    this.releaseStream()
    this.stopPlayback()
  }

  /** Deletes every recording of this training. */
  cleanUp() {
    this.stop()
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls = []
    this.lastRecording = null
  }

  /** Number of recordings still held (for tests). */
  get recordingCount(): number {
    return this.urls.length
  }
}
