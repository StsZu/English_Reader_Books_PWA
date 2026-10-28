import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ImportError } from '../../src/contracts.ts'
import { summarize } from '../../src/core/model/book.ts'
import { isContentEncrypted, parseNCX, parseNav, resolveHref } from '../../src/core/import/epub.ts'
import { htmlBlocks, htmlDocument } from '../../src/core/import/html.ts'
import { makeBook } from '../../src/core/model/segmenter.ts'
import { skippedSummary } from '../../src/ui/library/LibraryScreen.tsx'
import { formatForExtension, importBook, importFile, maxFileSize } from '../../src/core/import/importer.ts'
import { decodeText, parseMarkdown, parsePlainText } from '../../src/core/import/text.ts'
import { ZipArchive, ZipError } from '../../src/core/import/zip.ts'
import { demoBook } from '../fixtures/language.ts'
import { makeEPUB, makeFormattedEPUB, zipArchive } from '../fixtures/zip-writer.ts'

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

describe('неповний або завеликий EPUB (R2, R4)', () => {
  it('файл зі spine, якого немає в архіві: книжка без нього й назва файла у звіті', async () => {
    const unreadable: string[] = []
    const book = await importBook(makeEPUB({}, ['OEBPS/text/ch2.xhtml']), 'epub', 'x', unreadable)
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1'])
    expect(unreadable).toEqual(['ch2.xhtml'])
    const complete: string[] = []
    await importBook(makeEPUB(), 'epub', 'x', complete)
    expect(complete).toEqual([])
  })

  it('запис, що розгортається понад заявлений розмір, не розпаковується до кінця', async () => {
    const big = 'x'.repeat(100_000)
    const zip = new ZipArchive(zipArchive([['a.txt', big, true, 1000]]))
    await expect(zip.read('a.txt')).rejects.toMatchObject({ reason: 'corrupted' })
  })

  it('архів понад бюджет розпакування — зрозуміла помилка ще до розпакування', async () => {
    const zip = new ZipArchive(zipArchive([['a.txt', 'abc', true], ['b.txt', 'x'.repeat(2000), true]]), 1000)
    expect(await zip.readText('a.txt')).toBe('abc')
    await expect(zip.read('b.txt')).rejects.toBeInstanceOf(ZipError)
    await expect(zip.read('b.txt')).rejects.toMatchObject({ reason: 'tooLarge' })
    const huge = zipArchive([
      ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>', false],
      ['c.opf', '<package><metadata/><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>', false],
      ['a.xhtml', '<p>Text.</p>', true, 300 * 1024 * 1024],
    ])
    await expect(importBook(huge, 'epub', 'x')).rejects.toMatchObject({ error: { kind: 'tooLargeUnpacked' } })
  })
})

describe('зміст, курсив і пропущене в EPUB (specs/011-epub-formatting)', () => {
  it('курсив і жирний — діапазони в тексті після сутностей і стиснення пробілів; текст той самий, що без розмітки', () => {
    const html = '<p>  He  read <i>The&nbsp;Times</i>\n every <em> morning </em>&amp; <b>slept</b>.</p><h2>A <i>Title</i></h2>'
    const doc = htmlDocument(html)
    const plain = htmlBlocks(html.replace(/<\/?(i|em|b)>/g, ''))
    expect(doc.blocks.map((b) => b.text)).toEqual(plain.map((b) => b.text))
    const [p, h] = doc.blocks
    expect(p.marks!.map((m) => [m.style, p.text.slice(m.start, m.end)])).toEqual([['italic', 'The Times'], ['italic', 'morning'], ['bold', 'slept']])
    expect(h.marks!.map((m) => h.text.slice(m.start, m.end))).toEqual(['Title'])
    expect(htmlDocument('<p>No styles here.</p>').blocks[0].marks).toBeUndefined()
  })

  it('id елементів вказують на свій блок; ілюстрації й знаки приміток рахуються', () => {
    const doc = htmlDocument('<p>Before</p><h2 id="s2">Scene</h2><p>Text<a id="mid"/> more</p><div id="empty"></div><p>After<sup><a href="#n">1</a></sup> <a epub:type="noteref" href="#m">2</a></p><img src="x"/><svg><image href="y"/></svg><sup>th</sup>')
    expect(doc.anchors).toEqual({ s2: 1, mid: 2, empty: 3 })
    expect(doc.images).toBe(2)
    expect(doc.notes).toBe(2)
  })

  it('зміст EPUB 3 (nav) і EPUB 2 (NCX): рівні, файли відносно документа змісту, якорі', () => {
    expect(parseNav('<nav epub:type="toc"><ol><li><a href="a.xhtml">A</a><ol><li><a href="a.xhtml#x%20y">A <b>1</b></a></li></ol></li></ol></nav><nav epub:type="landmarks"><ol><li><a href="b.xhtml">L</a></li></ol></nav>', 'OEBPS/nav/toc.xhtml'))
      .toEqual([
        { title: 'A', level: 0, source: 'OEBPS/nav/a.xhtml', anchor: '' },
        { title: 'A 1', level: 1, source: 'OEBPS/nav/a.xhtml', anchor: 'x y' },
      ])
    expect(parseNCX('<ncx><navMap><navPoint><navLabel><text>One</text></navLabel><content src="t/1.html#p"/><navPoint><navLabel><text>One.1</text></navLabel><content src="t/1.html#q"/></navPoint></navPoint><navPoint><navLabel><text>Two</text></navLabel><content src="t/2.html"/></navPoint></navMap></ncx>', 'OEBPS/toc.ncx'))
      .toEqual([
        { title: 'One', level: 0, source: 'OEBPS/t/1.html', anchor: 'p' },
        { title: 'One.1', level: 1, source: 'OEBPS/t/1.html', anchor: 'q' },
        { title: 'Two', level: 0, source: 'OEBPS/t/2.html', anchor: '' },
      ])
  })

  it('імпорт: зміст з адресами абзаців, курсив у реченнях, підрахунок пропущеного', async () => {
    const skipped = { images: 0, notes: 0, pages: 0 }
    const book = await importBook(makeFormattedEPUB(), 'epub', 'f', [], skipped)
    expect(skipped).toEqual({ images: 1, notes: 1, pages: 1 })
    expect(skippedSummary(skipped)).toBe('ілюстрацій: 1, приміток: 1, додаткових сторінок: 1')
    expect(skippedSummary({ images: 0, notes: 0, pages: 0 })).toBe('')
    const scene = book.chapters[0].paragraphs.findIndex((p) => p.sentences[0] === 'The Second Scene')
    expect(book.contents).toEqual([
      { title: 'Part One', level: 0, chapter: 0, paragraph: 0 },
      { title: 'The Second Scene', level: 1, chapter: 0, paragraph: scene },
      { title: 'Part Two', level: 0, chapter: 1, paragraph: 0 },
    ])
    const first = book.chapters[0].paragraphs[1]
    expect(first.sentences).toEqual(['He read The Times every morning.', 'It was his habit & pride.'])
    expect(first.marks!.map((m) => [m.sentence, m.style, first.sentences[m.sentence].slice(m.start, m.end)]))
      .toEqual([[0, 'italic', 'The Times'], [1, 'italic', 'his'], [1, 'bold', 'pride']])
    expect(book.chapters[0].paragraphs[scene + 1].sentences).toEqual(['She came later that night.'])
  })

  it('зміст без жодного знайденого пункту не зберігається; розділ без пункту отримує власний', () => {
    const chapter = (source: string, text: string) => ({ title: text, source, anchors: {}, blocks: [{ kind: 'text' as const, text }] })
    const raw = { title: 'T', author: '', chapters: [chapter('a.html', 'One.'), chapter('b.html', 'Two.')] }
    expect(makeBook({ ...raw, contents: [{ title: 'X', level: 0, source: 'z.html', anchor: '' }] }, 'epub').contents).toBeUndefined()
    expect(makeBook({ ...raw, contents: [{ title: 'B', level: 0, source: 'b.html', anchor: '' }, { title: 'Gone', level: 1, source: 'b.html', anchor: 'nope' }] }, 'epub').contents)
      .toEqual([{ title: 'One.', level: 0, chapter: 0, paragraph: 0 }, { title: 'B', level: 0, chapter: 1, paragraph: 0 }])
    expect(makeBook(raw, 'epub').contents).toBeUndefined()
  })
})
