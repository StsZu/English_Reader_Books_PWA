import { describe, expect, it } from 'vitest'
import { formatDayMonth, formatNumber, linesLabel, scaleLabel } from '../../src/core/util/format.ts'

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
})
