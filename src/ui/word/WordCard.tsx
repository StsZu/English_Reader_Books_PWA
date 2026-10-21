// Port of EnglishReader/Views/WordCardView.swift: the context-aware word card (R4, DT2–DT6, Z1).
import { Button, ProgressSpinner, Sheet } from '../components/index.ts'
import { Icon } from '../icons.tsx'
import { enabledDictionaries, settings } from '../../core/storage/settings.ts'
import type { WordLookup } from '../reader/types.ts'
import { dictionaryInfo, openDictionary } from './dictionaries.ts'
import './word.css'

export interface WordCardProps {
  lookup: WordLookup | null
  /** Why the system voice is speaking instead of the AI voice. */
  notice: string | null
  saved: boolean
  onToggleSave: () => void
  onPronounce: (text: string) => void
  onExplain: (regenerate: boolean) => void
  onOpenSettings: () => void
  onClose: () => void
}

export function WordCard(props: WordCardProps) {
  const { lookup, onClose } = props
  return (
    <Sheet open={lookup !== null} onClose={onClose} detents={['medium', 'large']} ariaLabel="Картка слова"
      testID="wordCard" width={640}>
      {lookup && <WordCardContent {...props} lookup={lookup} />}
    </Sheet>
  )
}

function WordCardContent({ lookup, notice, saved, onToggleSave, onPronounce, onExplain, onOpenSettings }: WordCardProps & { lookup: WordLookup }) {
  const card = lookup.card
  const scale = settings.wordCardScale.value
  const differentLemma = card ? card.lemma.toLowerCase() !== lookup.word.toLowerCase() : false
  const detail = card ? [card.partOfSpeech, differentLemma ? `початкова форма: ${card.lemma}` : ''].filter(Boolean).join(' · ') : ''
  const dictionaries = enabledDictionaries()
  const term = card?.lemma ? card.lemma : lookup.word

  return (
    <div class="word-card" style={{ '--card-scale': String(scale) }} data-testid="wordCardContent">
      <div class="word-head">
        <span class="word-headword" data-testid="wordHeadword">{card?.headword ?? lookup.word}</span>
        {card?.ipa ? <span class="word-ipa">/{card.ipa}/</span> : null}
        {settings.showWordLevel.value && card?.level
          ? <span class="word-level" aria-label={`Рівень ${card.level}`} data-testid="wordLevel">{card.level}</span>
          : null}
        <span class="word-spacer" />
        <div class="word-actions">
          {card && lookup.ref && (
            <Button variant="bordered" icon="bookmark" class={saved ? 'is-saved' : undefined} onClick={onToggleSave}
              testID="saveWordButton">
              {saved ? 'Збережено' : 'Зберегти'}
            </Button>
          )}
          <Button variant="borderedProminent" icon="speaker.wave.3.fill" onClick={() => onPronounce(lookup.word)}
            testID="pronounceButton">
            Вимова
          </Button>
        </div>
      </div>
      {notice && <p class="word-notice" data-testid="pronunciationNotice">{notice}</p>}

      {card ? (
        <>
          {detail && <p class="word-detail">{detail}</p>}
          {settings.showWordForms.value && card.forms && (
            <div class="word-forms-row">
              <span class="word-forms" data-testid="wordForms">{card.forms}</span>
              {card.irregular && <span class="word-irregular" data-testid="wordIrregular">неправильна форма</span>}
            </div>
          )}
          <div class="word-block">
            <span class="word-caption">У цьому реченні</span>
            <span class="word-context" data-testid="wordContextTranslation">{card.contextTranslation}</span>
          </div>
          {card.otherTranslations.length > 0 && (
            <div class="word-block">
              <span class="word-caption">Інші значення</span>
              <span class="word-other" data-testid="wordOtherTranslations">{card.otherTranslations.join(', ')}</span>
            </div>
          )}
          {card.note && <p class="word-note">{card.note}</p>}
          <Explanation lookup={lookup} onExplain={onExplain} onOpenSettings={onOpenSettings} />
        </>
      ) : lookup.error ? (
        <div class="word-error-block">
          <p class="word-error" data-testid="wordError">
            <Icon name="exclamationmark.triangle.fill" size={18} />
            <span>{lookup.error}</span>
          </p>
          {lookup.needsSettings && (
            <Button variant="bordered" onClick={onOpenSettings} testID="wordOpenSettings">Відкрити налаштування</Button>
          )}
          <p class="word-hint">Вимову можна прослухати й без перекладу.</p>
        </div>
      ) : (
        <div class="word-loading" data-testid="wordLoading">
          <ProgressSpinner />
          <span>Шукаю значення в контексті…</span>
        </div>
      )}

      {dictionaries.length > 0 && (
        <div class="word-block">
          <span class="word-caption">Словники</span>
          <div class="word-dictionaries" data-testid="wordDictionaries">
            {dictionaries.map((id) => (
              <Button key={id} variant="bordered" onClick={() => openDictionary(id, term)} testID={`dictionary-${id}`}>
                {dictionaryInfo(id).title}
              </Button>
            ))}
          </div>
        </div>
      )}

      <hr class="word-divider" />
      <p class="word-sentence" data-testid="wordSentence">{lookup.sentence}</p>
    </div>
  )
}

function Explanation({ lookup, onExplain, onOpenSettings }: {
  lookup: WordLookup
  onExplain: (regenerate: boolean) => void
  onOpenSettings: () => void
}) {
  return (
    <div class="word-explanation">
      {lookup.explanation !== null && (
        <>
          <span class="word-caption">Пояснення</span>
          <p class="word-explanation-text" data-testid="wordExplanation">{lookup.explanation}</p>
        </>
      )}
      {lookup.explaining ? (
        <div class="word-loading word-loading-small" data-testid="explanationLoading">
          <ProgressSpinner size="small" />
          <span>Готую пояснення…</span>
        </div>
      ) : lookup.explanationError ? (
        <>
          <p class="word-error word-error-small" data-testid="explanationError">
            <Icon name="exclamationmark.triangle.fill" size={16} />
            <span>{lookup.explanationError}</span>
          </p>
          {lookup.explanationNeedsSettings && (
            <Button variant="bordered" onClick={onOpenSettings} testID="explanationOpenSettings">Відкрити налаштування</Button>
          )}
        </>
      ) : null}
      {!lookup.explaining && (
        <>
          <div>
            <Button variant="bordered" icon="sparkles" onClick={() => onExplain(lookup.explanation !== null)}
              testID={lookup.explanation === null ? 'explainButton' : 'explainAgainButton'}>
              {lookup.explanation === null ? 'Пояснити детальніше' : 'Пояснити ще раз'}
            </Button>
          </div>
          <span class="word-paid">Окремий платний запит до OpenAI.</span>
        </>
      )}
    </div>
  )
}
