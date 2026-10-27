// Synthetic books for e2e import tests, built in memory (nothing third-party is committed).
import { makeEPUB, zipArchive } from '../zip-writer.ts'

export interface FilePayload { name: string; mimeType: string; buffer: Buffer }

const file = (name: string, mimeType: string, data: Uint8Array | string): FilePayload =>
  ({ name, mimeType, buffer: Buffer.from(typeof data === 'string' ? new TextEncoder().encode(data) : data) })

export const storedEPUB = (): FilePayload => file('Test Book.epub', 'application/epub+zip', makeEPUB())

/** An EPUB whose second chapter is listed in the OPF but missing from the archive (R2). */
export const partialEPUB = (): FilePayload =>
  file('Partial.epub', 'application/epub+zip', makeEPUB({}, ['OEBPS/text/ch2.xhtml']))

export const drmEPUB = (): FilePayload =>
  file('Locked.epub', 'application/epub+zip', makeEPUB({ 'META-INF/rights.xml': '<rights/>' }))

/** A ZIP without META-INF/container.xml. */
export const brokenEPUB = (): FilePayload =>
  file('Broken.epub', 'application/epub+zip', zipArchive([['readme.txt', 'not a book', false]]))

/** Bytes that are not a ZIP at all. */
export const garbageEPUB = (): FilePayload => file('Garbage.epub', 'application/epub+zip', 'this is not a zip file at all')

export const pdfFile = (): FilePayload => file('Paper.pdf', 'application/pdf', '%PDF-1.4\n%fake\n')

export const plainText = (): FilePayload =>
  file('Notes.txt', 'text/plain', 'CHAPTER I\n\nIt was a bright cold day in April. The clocks were striking.\n\nSecond paragraph here.\n')
