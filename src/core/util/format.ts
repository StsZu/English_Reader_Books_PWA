// Ukrainian number and date formatting (decimal comma), ports of AppSettings.linesLabel and helpers.

const formatters = new Map<string, Intl.NumberFormat>()

/** Number with a decimal comma, `minDigits`…`maxDigits` fraction digits (uk-UA). */
export function formatNumber(value: number, maxDigits = 2, minDigits = 0): string {
  const key = `${minDigits}-${maxDigits}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits, useGrouping: false })
    formatters.set(key, formatter)
  }
  return formatter.format(value)
}

/** "1 рядок", "2 рядки", "5 рядків", "0,5 рядка". */
export function linesLabel(lines: number): string {
  const number = formatNumber(lines, 1)
  if (lines !== Math.round(lines)) return `${number} рядка`
  const n = Math.round(lines)
  if (n === 1) return `${number} рядок`
  if (n >= 2 && n <= 4) return `${number} рядки`
  return `${number} рядків`
}

/** "дд.мм". */
export function formatDayMonth(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}`
}

/** "0,7×". */
export function scaleLabel(value: number, digits = 1): string {
  return `${formatNumber(value, digits, digits)}×`
}

/** "4:05", "1:02:09" (audio time). */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** "820 КБ", "12,4 МБ", "1,2 ГБ". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)), 0)} КБ`
  if (bytes < 1024 ** 3) return `${formatNumber(bytes / 1024 ** 2, 1)} МБ`
  return `${formatNumber(bytes / 1024 ** 3, 1)} ГБ`
}
