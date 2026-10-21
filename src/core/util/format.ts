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
