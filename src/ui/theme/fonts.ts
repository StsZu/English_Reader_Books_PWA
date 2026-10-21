// Port of BookFont (EnglishReader/Services/AppSettings.swift). On iPadOS every family is a built-in font.
import type { BookFontName } from '../../core/storage/settings.ts'

export interface BookFontInfo {
  name: BookFontName
  label: string
  cssFamily: string
}

export const bookFonts: BookFontInfo[] = [
  { name: 'system', label: 'Системний', cssFamily: "ui-serif, 'New York', Georgia, serif" },
  { name: 'systemSans', label: 'Системний без зарубок', cssFamily: '-apple-system, system-ui, sans-serif' },
  { name: 'georgia', label: 'Georgia', cssFamily: 'Georgia, serif' },
  { name: 'charter', label: 'Charter', cssFamily: "Charter, 'Bitstream Charter', serif" },
  { name: 'iowan', label: 'Iowan Old Style', cssFamily: "'Iowan Old Style', serif" },
  { name: 'palatino', label: 'Palatino', cssFamily: "Palatino, 'Palatino Linotype', serif" },
  { name: 'baskerville', label: 'Baskerville', cssFamily: "Baskerville, 'Baskerville Old Face', serif" },
]

export const fontInfo = (name: BookFontName): BookFontInfo => bookFonts.find((f) => f.name === name) ?? bookFonts[0]

const lineHeights = new Map<string, number>()
let canvas: HTMLCanvasElement | null = null

/**
 * Natural line height of the font at this size (the analogue of UIFont.lineHeight):
 * measured once per font/size from the font's ascent and descent; falls back to 1.2 × size.
 */
export function lineHeight(name: BookFontName, size: number): number {
  const key = `${name}|${size}`
  const cached = lineHeights.get(key)
  if (cached !== undefined) return cached
  let height = 1.2 * size
  try {
    canvas ??= document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context) {
      context.font = `${size}px ${fontInfo(name).cssFamily}`
      const metrics = context.measureText('Hg')
      const measured = (metrics.fontBoundingBoxAscent ?? 0) + (metrics.fontBoundingBoxDescent ?? 0)
      if (measured > size * 0.8 && measured < size * 2) height = measured
    }
  } catch {
    // Canvas is unavailable (tests): keep the fallback.
  }
  lineHeights.set(key, height)
  return height
}
