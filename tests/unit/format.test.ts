import { describe, expect, it } from 'vitest'
import { formatBuildVersion, formatDayMonth, formatNumber, linesLabel, scaleLabel } from '../../src/core/util/format.ts'

describe('format', () => {
  // ServiceTests.testAutoHideThresholdUnitsAndLabels (labels)
  it('linesLabel з українськими формами', () => {
    expect(linesLabel(0.5)).toBe('0,5 рядка')
    expect(linesLabel(1)).toBe('1 рядок')
    expect(linesLabel(2)).toBe('2 рядки')
    expect(linesLabel(2.5)).toBe('2,5 рядка')
    expect(linesLabel(5)).toBe('5 рядків')
  })

  it('десяткова кома й масштаб', () => {
    expect(formatNumber(0.25, 2)).toBe('0,25')
    expect(formatNumber(22, 0)).toBe('22')
    expect(scaleLabel(0.7)).toBe('0,7×')
    expect(scaleLabel(1)).toBe('1,0×')
  })

  it('дата дд.мм', () => {
    expect(formatDayMonth(new Date(2026, 9, 5))).toBe('05.10')
  })

  it('версія збірки: час за Києвом (зима й літо) і хеш коміту, якщо він є', () => {
    expect(formatBuildVersion(new Date('2026-10-27T11:05:00Z'), 'f5eee21')).toBe('27.10.2026 13:05 · f5eee21')
    expect(formatBuildVersion(new Date('2026-07-01T21:30:00Z'), null)).toBe('02.07.2026 00:30')
  })
})
