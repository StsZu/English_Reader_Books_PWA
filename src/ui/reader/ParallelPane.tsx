// Port of ReaderView.swift → ParallelTranslationPane, SentenceSpeechControls, FragmentControls.
import type { ComponentChildren } from 'preact'
import { Button, IconButton, ProgressSpinner } from '../components/index.ts'
import { Icon } from '../icons.tsx'
import { paragraphKey, type SentenceRef } from '../../core/model/book.ts'
import { parallelTranslationFontSize, settings } from '../../core/storage/settings.ts'
import { OpenAISpeechEngine } from '../../core/speech/openai-speech.ts'
import { testFlags } from '../../app/test-mode.ts'
import { speechKeyID, type ReaderModel, type SpeechKey } from './model.ts'

export const paneHeight = () =>
  Math.max(64, parallelTranslationFontSize.value * 1.5 * (settings.parallelTranslationMultiline.value ? 3 : 1) + 20)

function Badge({ children, testID }: { children: ComponentChildren; testID: string }) {
  return <span class="pane-badge" data-testid={testID}>{children}</span>
}

function ScrollableText({ text, testID, secondary }: { text: string; testID: string; secondary?: boolean }) {
  const multiline = settings.parallelTranslationMultiline.value
  return (
    <div class={multiline ? 'pane-text multiline' : 'pane-text'} data-pane-scroll>
      <span class={secondary ? 'secondary' : undefined} data-testid={testID}>{text}</span>
    </div>
  )
}

function SpeechNotice({ model }: { model: ReaderModel }) {
  const notice = model.sentenceSpeechNotice.value
  if (!notice) return null
  return (
    <span class="pane-warning" title={notice} aria-label={notice} role="img" data-testid="sentenceSpeechNotice">
      <Icon name="exclamationmark.triangle.fill" size={18} />
    </span>
  )
}

function SpeechControls({ model, speechKey, idle }: { model: ReaderModel; speechKey: SpeechKey; idle: ComponentChildren }) {
  const speech = model.sentenceSpeech.value
  if (speech && speechKeyID(speech.key) === speechKeyID(speechKey)) {
    return (
      <>
        {speech.phase === 'preparing' && <span aria-label="Готую аудіо" data-testid="sentenceSpeechPreparing"><ProgressSpinner size="small" /></span>}
        <Button variant="bordered" size="small" icon="stop.fill" onClick={() => model.stopSentenceSpeech()} testID="stopSentenceSpeech">Стоп</Button>
      </>
    )
  }
  return <>{idle}</>
}

function SentenceControls({ model, sentenceRef: ref }: { model: ReaderModel; sentenceRef: SentenceRef }) {
  const key: SpeechKey = { kind: 'sentence', ref }
  return (
    <div class="pane-controls">
      <SpeechNotice model={model} />
      <SpeechControls model={model} speechKey={key} idle={model.canReplay(key) && (
        <Button variant="bordered" size="small" icon="arrow.counterclockwise" onClick={() => model.speakSentence(ref, true)} testID="replaySentence">Ще раз</Button>
      )} />
    </div>
  )
}

function FragmentControls({ model, text }: { model: ReaderModel; text: string }) {
  const key: SpeechKey = { kind: 'fragment', text }
  const copied = model.fragmentCopied.value
  const done = model.fragmentTranslation.value?.kind === 'done'
  const saved = model.isFragmentSaved
  return (
    <div class="pane-controls">
      <SpeechNotice model={model} />
      <SpeechControls model={model} speechKey={key} idle={model.canReplay(key)
        ? <Button variant="bordered" size="small" icon="arrow.counterclockwise" onClick={() => model.speakFragment(true)} testID="replayFragment">Ще раз</Button>
        : <Button variant="bordered" size="small" icon="speaker.wave.2" onClick={() => model.speakFragment(false)} testID="speakFragment">Прослухати</Button>} />
      <Button variant="bordered" size="small" icon={copied ? 'checkmark' : 'doc.on.doc'} onClick={() => void model.copyFragment()} testID="copyFragment">
        {copied ? 'Скопійовано' : 'Копіювати'}
      </Button>
      {done && (
        <Button variant="bordered" size="small" icon="bookmark" selected={saved} onClick={() => model.saveFragment()} testID="saveFragment"
          class={saved ? 'filled-icon' : undefined}>
          {saved ? 'Збережено' : 'Зберегти'}
        </Button>
      )}
    </div>
  )
}

function Loading() {
  return (
    <>
      <ProgressSpinner size="small" />
      <span data-testid="translationLoading">Перекладаю…</span>
      <span class="pane-spacer" />
    </>
  )
}

export function ParallelPane({ model, openSettings }: { model: ReaderModel; openSettings: () => void }) {
  const selection = model.selection.value
  const active = model.activeSentence.value
  let content: ComponentChildren

  if (selection) {
    const fragment = model.fragmentTranslation.value
    content = (
      <>
        <Badge testID="fragmentBadge">Фрагмент</Badge>
        {!fragment && <ScrollableText text={selection.text} testID="fragmentSource" secondary />}
        {fragment?.kind === 'loading' && <Loading />}
        {fragment?.kind === 'done' && <ScrollableText text={fragment.line} testID="fragmentTranslation" />}
        {fragment?.kind === 'failed' && (
          <>
            <ScrollableText text={fragment.message} testID="fragmentError" />
            <Button variant="plain" size="small" onClick={() => model.retryFragment()} testID="retryFragment">Повторити</Button>
          </>
        )}
        {fragment?.kind === 'needsSettings' && (
          <>
            <ScrollableText text={fragment.message} testID="noticeText" />
            <Button variant="plain" size="small" onClick={openSettings} testID="openSettingsFromPane">Налаштування</Button>
          </>
        )}
        {fragment && <FragmentControls model={model} text={selection.text} />}
        <IconButton icon="xmark" label="Скасувати виділення" tone="label" onClick={() => model.clearSelection()} testID="hideParallelTranslation" />
      </>
    )
  } else if (active) {
    const notice = model.translationNotice.value
    const state = model.translationState(active.paragraph)
    let body: ComponentChildren
    if (notice) {
      body = (
        <>
          <ScrollableText text={notice} testID="noticeText" />
          <Button variant="plain" size="small" onClick={openSettings} testID="openSettingsFromPane">Налаштування</Button>
        </>
      )
    } else if (state?.kind === 'done' && active.sentence < state.lines.length) {
      body = (
        <>
          <ScrollableText text={state.lines[active.sentence]} testID={`translation-${paragraphKey(active.paragraph)}-${active.sentence}`} />
          <SentenceControls model={model} sentenceRef={active} />
        </>
      )
    } else if (state?.kind === 'failed') {
      body = (
        <>
          <ScrollableText text={state.message} testID="translationError" />
          <Button variant="plain" size="small" onClick={() => model.retry(active.paragraph)} testID="retryTranslation">Повторити</Button>
        </>
      )
    } else {
      body = <Loading />
    }
    content = (
      <>
        {body}
        <IconButton icon="xmark" label="Приховати переклад" tone="label" onClick={() => model.hideParallelTranslation()} testID="hideParallelTranslation" />
      </>
    )
  } else {
    content = (
      <>
        <span class="pane-hint" data-testid="parallelTranslationHint">Торкніться речення для перекладу, утримуйте перекладене — щоб прослухати</span>
        <span class="pane-spacer" />
      </>
    )
  }

  const fixture = __TEST_MODE__ && testFlags.speech
    ? `synthesis:${OpenAISpeechEngine.synthesisCount} speech:${model.sentenceSpeech.value?.phase ?? 'idle'}`
    : undefined
  return (
    <section class="parallel-pane" data-testid="parallelTranslationPane" data-testvalue={fixture}
      style={{ height: `${paneHeight()}px`, fontSize: `${parallelTranslationFontSize.value}px` }}>
      <div class="pane-row">{content}</div>
    </section>
  )
}
