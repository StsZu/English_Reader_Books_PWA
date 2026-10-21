// «Керування словниками» (DictionaryManagerView, DT2): which web dictionaries the word card offers and in what order.
// Shown inside the panel as a pushed page; rows reorder by dragging their handle.
import { useRef, useState } from 'preact/hooks'
import {
  dictionaryOrder, isDictionaryEnabled, setDictionaryEnabled, setDictionaryOrder, type ExternalDictionaryID,
} from '../../../core/storage/settings.ts'
import { Toggle } from '../../components/index.ts'
import { Icon } from '../../icons.tsx'
import { dictionaryInfo, dictionaryURL } from '../../word/dictionaries.ts'

interface Drag {
  id: ExternalDictionaryID
  pointer: number
  startY: number
  dy: number
  rowHeight: number
}

export function DictionaryManager({ onDone }: { onDone: () => void }) {
  const order = dictionaryOrder()
  const [drag, setDrag] = useState<Drag | null>(null)
  const list = useRef<HTMLDivElement>(null)

  function move(id: ExternalDictionaryID, to: number) {
    const next = order.filter((d) => d !== id)
    next.splice(Math.max(0, Math.min(next.length, to)), 0, id)
    setDictionaryOrder(next)
  }

  const fromIndex = drag ? order.indexOf(drag.id) : -1
  const targetIndex = drag ? Math.max(0, Math.min(order.length - 1, fromIndex + Math.round(drag.dy / drag.rowHeight))) : -1

  function start(event: PointerEvent, id: ExternalDictionaryID) {
    const row = (event.currentTarget as HTMLElement).closest('.rp-dict-row') as HTMLElement | null
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    event.preventDefault()
    setDrag({ id, pointer: event.pointerId, startY: event.clientY, dy: 0, rowHeight: row?.offsetHeight || 60 })
  }
  function update(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return
    setDrag({ ...drag, dy: event.clientY - drag.startY })
  }
  function end(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return
    if (targetIndex !== fromIndex) move(drag.id, targetIndex)
    setDrag(null)
  }

  function offset(index: number): number {
    if (!drag) return 0
    if (index === fromIndex) return drag.dy
    if (fromIndex < targetIndex && index > fromIndex && index <= targetIndex) return -drag.rowHeight
    if (fromIndex > targetIndex && index < fromIndex && index >= targetIndex) return drag.rowHeight
    return 0
  }

  function test(id: ExternalDictionaryID) {
    const url = dictionaryURL(id, 'book')
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <div class="rp-page" data-testid="dictionaryManager">
      <div class="rp-page-bar">
        <button type="button" class="rp-back" onClick={onDone} data-testid="dictionariesBack">
          <Icon name="chevron.left" size={22} strokeWidth={2.4} />
          <span>Назад</span>
        </button>
        <span class="rp-page-title">Керування словниками</span>
        <button type="button" class="rp-done" onClick={onDone} data-testid="dictionariesDone">Готово</button>
      </div>
      <div class="rp-scroll">
        <div class="rp-dict-card" ref={list}>
          {order.map((id, index) => {
            const info = dictionaryInfo(id)
            const shift = offset(index)
            return (
              <div
                key={id}
                class={drag?.id === id ? 'rp-dict-row is-dragging' : 'rp-dict-row'}
                style={shift ? { transform: `translateY(${shift}px)` } : undefined}
                data-testid={`dictionaryRow-${id}`}
              >
                <span
                  class="rp-dict-handle"
                  role="button"
                  aria-label={`Перетягнути: ${info.title}`}
                  onPointerDown={(e) => start(e, id)}
                  onPointerMove={update}
                  onPointerUp={end}
                  onPointerCancel={() => setDrag(null)}
                  data-testid={`dragDictionary-${id}`}
                >
                  <Icon name="line.3.horizontal" size={20} />
                </span>
                <span class="rp-dict-text">
                  <span class="rp-dict-title">{info.title}</span>
                  <span class="rp-dict-subtitle">{info.subtitle}</span>
                </span>
                <button type="button" class="visually-hidden" disabled={index === 0}
                  onClick={() => move(id, index - 1)} data-testid={`moveUp-${id}`}>
                  Перемістити вище: {info.title}
                </button>
                <button type="button" class="visually-hidden" disabled={index === order.length - 1}
                  onClick={() => move(id, index + 1)} data-testid={`moveDown-${id}`}>
                  Перемістити нижче: {info.title}
                </button>
                <button type="button" class="rp-text-button" onClick={() => test(id)} data-testid={`testDictionary-${id}`}>
                  Перевірити
                </button>
                <Toggle checked={isDictionaryEnabled(id)} onChange={(v) => setDictionaryEnabled(id, v)}
                  ariaLabel={info.title} testID={`enableDictionary-${id}`} />
              </div>
            )
          })}
        </div>
        <p class="rp-footnote rp-page-footer">
          Перетягніть рядок, щоб змінити порядок кнопок у картці слова. «Перевірити» відкриває сторінку слова «book».
        </p>
      </div>
    </div>
  )
}
