// «Поділитися» (Z5): the system share sheet with a file, or a download where files cannot be shared.
import { quotesText, wordsCSV, type SavedQuote, type SavedWord } from '../../core/saved/saved.ts'

export interface ExportFile {
  name: string
  type: string
  contents: string
}

export function wordsFile(list: SavedWord[]): ExportFile {
  return { name: 'Слова.csv', type: 'text/csv', contents: wordsCSV(list) }
}

export function quotesFile(list: SavedQuote[]): ExportFile {
  return { name: 'Цитати.txt', type: 'text/plain', contents: quotesText(list) }
}

/** Returns how the file left the app: shared, downloaded, or cancelled by the user. */
export async function shareFile(file: ExportFile): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([file.contents], { type: `${file.type};charset=utf-8` })
  const shared = new File([blob], file.name, { type: file.type })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [shared] })) {
    try {
      await navigator.share({ files: [shared], title: file.name })
      return 'shared'
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
