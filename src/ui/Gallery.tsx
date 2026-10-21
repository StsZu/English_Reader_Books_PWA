// Design-system showcase (dev/test only, `?gallery`): every component in the current reader theme.
import { useEffect, useState } from 'preact/hooks'
import type { ReaderThemeName } from '../core/storage/settings.ts'
import { Icon } from './icons.tsx'
import { applyTheme, readerThemes } from './theme/themes.ts'
import { bookFonts } from './theme/fonts.ts'
import {
  Badge, Button, ConfirmDialog, ContentUnavailable, ContextMenu, Disclosure, FormSheet, IconButton, List, NavBar,
  NoticeBar, ProgressSpinner, Row, SearchField, SecureField, Section, Segmented, Sheet, SidePanel, Stepper, Tabs,
  TextArea, TextField, Toggle,
} from './components/index.ts'
import './gallery.css'

export function Gallery() {
  const [theme, setTheme] = useState<ReaderThemeName>(
    (new URLSearchParams(location.search).get('theme') as ReaderThemeName | null) ?? 'sepia')
  const [tab, setTab] = useState<'settings' | 'contents' | 'saved'>('settings')
  const [size, setSize] = useState(22)
  const [spacing, setSpacing] = useState(0.25)
  const [on, setOn] = useState(true)
  const [off, setOff] = useState(false)
  const [segment, setSegment] = useState<number>(10)
  const [expanded, setExpanded] = useState(true)
  const [text, setText] = useState('')
  const [secret, setSecret] = useState('')
  const [area, setArea] = useState('Поясни українською значення слова «{слово}» у реченні: «{контекст}».')
  const [search, setSearch] = useState('')
  const [sheet, setSheet] = useState(false)
  const [bottomSheet, setBottomSheet] = useState(false)
  const [form, setForm] = useState(false)
  const [panel, setPanel] = useState(false)
  const [dialog, setDialog] = useState(false)

  useEffect(() => applyTheme(theme), [theme])

  return (
    <div class="gallery">
      <NavBar
        title="Компоненти"
        onBack={() => history.back()}
        trailing={<>
          <IconButton icon="list.bullet" label="Зміст" />
          <IconButton icon="character.bubble" label="Паралельний переклад" selected />
          <IconButton icon="textformat" label="Вигляд" />
          <IconButton icon="gearshape" label="ШІ-сервіси" />
        </>}
      />
      <NoticeBar text="Озвучення зупинено: Немає з'єднання з інтернетом." actionTitle="Закрити" onAction={() => {}} />
      <div class="gallery-body">
        <div class="gallery-column">
          <Section header="Тема читання">
            <div class="gallery-themes">
              {readerThemes.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  class={`gallery-theme ${theme === t.name ? 'is-active' : ''}`}
                  onClick={() => setTheme(t.name)}
                  data-testid={`gallery-theme-${t.name}`}
                >
                  <span class="gallery-theme-sample" style={{ background: t.background, color: t.text }}>Аа</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section header="Кнопки">
            <div class="gallery-wrap">
              <Button icon="play.fill" variant="bordered">Слухати</Button>
              <Button icon="pause.fill" variant="bordered">Пауза</Button>
              <Button icon="stop.fill" variant="bordered" disabled>Стоп</Button>
              <Button variant="borderedProminent">Почати</Button>
              <Button variant="destructive" icon="trash">Видалити</Button>
              <Button variant="plain" icon="plus">Імпорт</Button>
              <Button variant="bordered" size="small">Повторити</Button>
              <IconButton icon="xmark" label="Закрити" tone="secondary" />
            </div>
          </Section>

          <Section header="Вкладки">
            <div class="gallery-pad">
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { value: 'settings', label: 'Налаштування' },
                  { value: 'contents', label: 'Зміст' },
                  { value: 'saved', label: 'Збережене' },
                ]}
              />
            </div>
          </Section>

          <Disclosure title="Текст книги" icon="textformat.size" expanded={expanded} onToggle={() => setExpanded(!expanded)}>
            <Row title="Шрифт" value="Системний" chevron onClick={() => {}} />
            <Stepper title="Розмір шрифту" id="fontSize" display={String(size)} value={size} min={14} max={40} step={1} onChange={setSize} />
            <Stepper title="Міжрядковий інтервал" id="lineSpacing" display={spacing.toFixed(2).replace('.', ',')}
              value={spacing} min={0} max={1} step={0.05} onChange={setSpacing} />
            <Stepper title="Приховувати після прокручування" id="autoHide" display="1 рядок" value={1} min={0.5} max={5} step={0.5}
              onChange={() => {}} disabled={!on} />
            <Toggle label="Вирівнювання за шириною" checked={on} onChange={setOn} />
            <Toggle label="Багаторядковий переклад" checked={off} onChange={setOff} detail="Довгий переклад переноситься в панелі заввишки три рядки." />
          </Disclosure>
          <Disclosure title="Паралельний переклад" icon="character.bubble" expanded={false} onToggle={() => {}}>
            <span />
          </Disclosure>
        </div>

        <div class="gallery-column">
          <Section header="Сегменти" footer="Розмір набору для тренування.">
            <div class="gallery-pad">
              <Segmented ariaLabel="Кількість слів" value={segment} onChange={setSegment}
                items={[{ value: 10, label: '10' }, { value: 20, label: '20' }, { value: 30, label: '30' }]} />
            </div>
          </Section>

          <Section header="Список" footer="Ключ зберігається лише в цьому браузері.">
            <Row icon="gearshape" title="ШІ-сервіси" chevron onClick={() => {}} />
            <Row icon="bookmark" title="Збережене" value="12" chevron onClick={() => {}} />
            <Row title="Видалити ключ" destructive onClick={() => {}} />
            <Row title="Georgia" selected onClick={() => {}} />
          </Section>

          <Section header="Поля">
            <div class="gallery-pad gallery-stack">
              <TextField value={text} onInput={setText} placeholder="Модель" />
              <SecureField value={secret} onInput={setSecret} placeholder="sk-…" ariaLabel="Ключ OpenAI" />
              <TextArea value={area} onInput={setArea} ariaLabel="Шаблон" rows={3} />
              <SearchField value={search} onInput={setSearch} placeholder="Пошук англійською або українською" />
            </div>
          </Section>

          <Section header="Стан">
            <div class="gallery-pad gallery-wrap">
              <ProgressSpinner size="small" />
              <ProgressSpinner />
              <ProgressSpinner size="large" />
              <Badge>Рівень A1</Badge>
              <Badge tone="secondary">Фрагмент</Badge>
              <Badge tone="orange">неправильна форма</Badge>
              <Badge tone="translation">рівень 2 · повторити 24.10</Badge>
            </div>
          </Section>

          <Section header="Шрифти книжки">
            <div class="gallery-pad gallery-stack">
              {bookFonts.map((f) => <span key={f.name} class="gallery-font" style={{ fontFamily: f.cssFamily }}>{f.label}</span>)}
            </div>
          </Section>

          <Section header="Накладки">
            <div class="gallery-pad gallery-wrap">
              <Button variant="bordered" onClick={() => setSheet(true)}>Аркуш</Button>
              <Button variant="bordered" onClick={() => setBottomSheet(true)}>Аркуш знизу</Button>
              <Button variant="bordered" onClick={() => setForm(true)}>Форма</Button>
              <Button variant="bordered" onClick={() => setPanel(true)}>Панель</Button>
              <Button variant="bordered" onClick={() => setDialog(true)}>Діалог</Button>
              <ContextMenu actions={[{ label: 'Видалити', icon: 'trash', destructive: true, onSelect: () => {} }]}>
                <div class="gallery-card">Утримуйте</div>
              </ContextMenu>
            </div>
          </Section>

          <ContentUnavailable icon="books.vertical" title="Бібліотека порожня"
            description="Натисніть «Імпорт», щоб додати книжку EPUB, TXT або MD." />
        </div>
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)} ariaLabel="Картка слова">
        <div class="gallery-pad gallery-stack">
          <span class="gallery-word">woman <span class="gallery-ipa">ˈwʊmən</span></span>
          <Badge>Рівень A1</Badge>
          <span>жінка</span>
        </div>
      </Sheet>
      <Sheet open={bottomSheet} bottom onClose={() => setBottomSheet(false)} ariaLabel="Аркуш знизу">
        <div class="gallery-pad">Тягніть ручку вгору або вниз.</div>
      </Sheet>
      <FormSheet open={form} onClose={() => setForm(false)} ariaLabel="ШІ-сервіси" title="ШІ-сервіси">
        <List>
          <Section header="Ключ OpenAI"><Row title="збережено" /></Section>
        </List>
      </FormSheet>
      <SidePanel open={panel} onClose={() => setPanel(false)} ariaLabel="Налаштування читання">
        <div class="gallery-pad"><Icon name="textformat" /> Панель 420 px</div>
      </SidePanel>
      <ConfirmDialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Видалити книжку «Demo»?"
        actions={[{ label: 'Видалити', role: 'destructive' }, { label: 'Скасувати', role: 'cancel' }]}
      />
    </div>
  )
}
