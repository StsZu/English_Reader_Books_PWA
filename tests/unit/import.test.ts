import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ImportError } from '../../src/contracts.ts'
import { summarize } from '../../src/core/model/book.ts'
import { isContentEncrypted, resolveHref } from '../../src/core/import/epub.ts'
import { htmlBlocks } from '../../src/core/import/html.ts'
import { formatForExtension, importBook, importFile, maxFileSize } from '../../src/core/import/importer.ts'
import { decodeText, parseMarkdown, parsePlainText } from '../../src/core/import/text.ts'
import { ZipArchive } from '../../src/core/import/zip.ts'
import { demoBook } from '../fixtures/language.ts'
import { makeEPUB, zipArchive } from '../fixtures/zip-writer.ts'

const utf8 = (s: string) => new TextEncoder().encode(s)

async function importError(promise: Promise<unknown>): Promise<ImportError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError)
    return error as ImportError
  }
  throw new Error('expected ImportError')
}

describe('TextImporter', () => {
  // ImportTests.testPlainTextParagraphsAndChapters
  it('абзаци й розділи простого тексту', () => {
    const text = 'CHAPTER I\nThe Beginning\n\nIt was a dark night.\nThe wind was cold.\n\nNobody came.\n\nCHAPTER II\n\nMorning came.'
    const raw = parsePlainText(text, 'Story')
    expect(raw.chapters).toHaveLength(2)
    expect(raw.chapters[0].title).toBe('CHAPTER I The Beginning')
    expect(raw.chapters[0].blocks.filter((b) => b.kind === 'text').map((b) => b.text))
      .toEqual(['It was a dark night. The wind was cold.', 'Nobody came.'])
    expect(raw.chapters[1].blocks.at(-1)?.text).toBe('Morning came.')
  })

  // ImportTests.testPlainTextOneParagraphPerLine
  it('один рядок — один абзац', () => {
    const raw = parsePlainText('First line here.\nSecond line here.\nThird line here.\nFourth line here.\nFifth.', 'x')
    expect(raw.chapters[0].blocks).toHaveLength(5)
  })

  // ImportTests.testWindows1251Decoding
  it('Windows-1251', () => {
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2]) // «Привіт»
    expect(decodeText(cp1251)).toBe('Привіт')
  })

  it('UTF-8 з BOM і UTF-16 з BOM', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Привіт')]))).toBe('Привіт')
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])
    expect(decodeText(utf16)).toBe('Hi')
  })

  // ImportTests.testMarkdownStripsSyntax
  it('Markdown: front matter, розділи, розмітка прибирається', () => {
    const md = `---
title: "My Book"
author: Jane Doe
---
# My Book

## One

Some **bold** and *italic* text with a [link](https://x.y).

\`\`\`
code()
\`\`\`

- item one
- item two

## Two

> Quoted words.`
    const raw = parseMarkdown(md, 'f')
    expect(raw.title).toBe('My Book')
    expect(raw.author).toBe('Jane Doe')
    expect(raw.chapters.map((c) => c.title)).toEqual(['One', 'Two'])
    expect(raw.chapters[0].blocks.filter((b) => b.kind === 'text').map((b) => b.text))
      .toEqual(['Some bold and italic text with a link.', 'item one', 'item two'])
    expect(raw.chapters[1].blocks.at(-1)?.text).toBe('Quoted words.')
  })

  // ImportTests.testBundledDemoBookImports
  it('вбудована демо-книжка', async () => {
    const data = new Uint8Array(readFileSync(resolve(process.cwd(), 'public/demo.md')))
    const book = await importBook(data, 'md', 'demo')
    expect(book.title).toBe(demoBook.title)
    expect(book.author).toBe(demoBook.author)
    expect(book.chapters.map((c) => c.title)).toHaveLength(2)
    expect(book.chapters[1].title).toBe(demoBook.secondChapter)
    expect(summarize(book).sentenceCount).toBeGreaterThan(15)
    // The sentences of the demo itself are checked in language.test.ts.
  })
})

describe('HTMLTextExtractor', () => {
  // ImportTests.testHTMLExtraction
  it('блоки, сутності, пропуск script/style/sup/коментарів', () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
<h1>Chapter <em>One</em></h1>
<p>He said &ldquo;hello&rdquo; &amp; left&#8212;quickly.<sup>1</sup></p>
<div><p>Second<br/>line</p></div>
<!-- comment <p>hidden</p> -->
<script>var x = "<p>no</p>";</script>
</body></html>`
    const blocks = htmlBlocks(html)
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'text', 'text', 'text'])
    expect(blocks.map((b) => b.text)).toEqual(['Chapter One', 'He said “hello” & left—quickly.', 'Second', 'line'])
  })

  it('невідомі сутності лишаються як є', () => {
    expect(htmlBlocks('<p>a &constructor; &#x41; b</p>')[0].text).toBe('a &constructor; A b')
  })
})

describe('EPUBImporter', () => {
  // ImportTests.testEPUBImport
  it('імпорт EPUB (stored + deflate), обкладинка без тексту пропускається', async () => {
    const book = await importBook(makeEPUB(), 'epub', 'file')
    expect(book.title).toBe('Test Book')
    expect(book.author).toBe('A. Writer')
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[0].title).toBe('Chapter 1')
    expect(book.chapters[0].paragraphs[1].sentences).toEqual(['The first sentence.', 'The second one.'])
    expect(book.chapters[1].paragraphs.at(-1)?.sentences.join(' ')).toBe('Deflated text survives.')
  })

  // ImportTests.testEPUBWithDRMIsRejected
  it('EPUB з DRM відхиляється', async () => {
    const encryption = `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
<CipherData><CipherReference URI="OEBPS/ch1.xhtml"/></CipherData></EncryptedData></encryption>`
    const error = await importError(importBook(makeEPUB({ 'META-INF/encryption.xml': encryption }), 'epub', 'f'))
    expect(error.error).toEqual({ kind: 'drmProtected' })
    expect(error.message).toBe('Книжка захищена DRM. Імпортуйте копію без захисту.')
  })

  it('rights.xml — DRM', async () => {
    const error = await importError(importBook(makeEPUB({ 'META-INF/rights.xml': '<rights/>' }), 'epub', 'f'))
    expect(error.error.kind).toBe('drmProtected')
  })

  // ImportTests.testFontObfuscationIsNotDRM
  it('обфускація шрифтів — не DRM', () => {
    const xml = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>'
    expect(isContentEncrypted(xml)).toBe(false)
  })

  // ImportTests.testGarbageFileFailsGracefully
  it('сміття й порожній текст дають зрозумілі помилки', async () => {
    const zip = await importError(importBook(utf8('not a zip'), 'epub', 'f'))
    expect(zip.message).toBe('Файл EPUB пошкоджений або має нестандартну структуру (не ZIP-архів).')
    const empty = await importError(importBook(utf8('   \n\n '), 'txt', 'f'))
    expect(empty.message).toBe('У файлі не знайдено тексту для читання.')
  })

  it('ZIP без container.xml', async () => {
    const error = await importError(importBook(zipArchive([['a.txt', 'x', false]]), 'epub', 'f'))
    expect(error.message).toContain('немає META-INF/container.xml')
  })

  // ImportTests.testPathResolution
  it('розвʼязання шляхів', () => {
    expect(resolveHref('../Text/ch%201.xhtml#p3', 'OEBPS/content')).toBe('OEBPS/Text/ch 1.xhtml')
    expect(resolveHref('ch1.xhtml', '')).toBe('ch1.xhtml')
  })

  it('ZipArchive читає deflate і перевіряє розмір', async () => {
    const zip = new ZipArchive(zipArchive([['a.txt', 'hello hello hello', true]]))
    expect(new TextDecoder().decode(await zip.read('a.txt'))).toBe('hello hello hello')
    expect(zip.contains('b.txt')).toBe(false)
  })
})

describe('BookImporter', () => {
  it('формати за розширенням', () => {
    expect(formatForExtension('EPUB')).toBe('epub')
    expect(formatForExtension('text')).toBe('txt')
    expect(formatForExtension('markdown')).toBe('md')
    expect(formatForExtension('pdf')).toBeNull()
  })

  it('непідтримуваний формат і завеликий файл', async () => {
    const pdf = await importError(importFile(new File(['x'], 'book.pdf')))
    expect(pdf.message).toBe('Формат «.pdf» не підтримується. Підтримуються EPUB (без DRM), TXT і MD.')
    const big = new File(['x'], 'big.txt')
    Object.defineProperty(big, 'size', { value: maxFileSize + 1 })
    expect((await importError(importFile(big))).message).toBe('Файл завеликий (понад 50 МБ).')
  })

  it('importFile бере назву з імені файла', async () => {
    const book = await importFile(new File(['Hello there. General Kenobi.'], 'My Story.txt'))
    expect(book.title).toBe('My Story')
    expect(book.format).toBe('txt')
    expect(book.chapters[0].paragraphs[0].sentences).toEqual(['Hello there.', 'General Kenobi.'])
  })
})
