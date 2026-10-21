# Перенесені тести (T52, SC-02)

Еталон: `English_Reader_Books/EnglishReaderTests` (64 модульні) і `EnglishReaderUITests` (18 UI). Стан на 2026-10-21.

## Модульні (64)

| Тест Swift | Тест PWA |
|---|---|
| testSentenceSegmentation, testWordRangesSkipPunctuation | `tests/unit/segmenter.test.ts` |
| testPlainTextParagraphsAndChapters, testPlainTextOneParagraphPerLine, testWindows1251Decoding, testMarkdownStripsSyntax, testBundledDemoBookImports, testHTMLExtraction, testEPUBImport, testEPUBWithDRMIsRejected, testFontObfuscationIsNotDRM, testGarbageFileFailsGracefully, testPathResolution | `tests/unit/import.test.ts` |
| testRealEPUBFromDisk | `tests/golden/golden.test.ts` (`npm run golden`, Gutenberg #1661 проти нативного імпортера) |
| testHTTPErrorMapping, testWordCardDecodingToleratesMissingOptionalFields, testTranslationStorePersistsAcrossInstances, testMissingKeyIsReportedBeforeNetwork, testWordCardDecodesLevelAndFormsAndOldCards, testExplanationIsCachedAndRegeneratedOnlyOnRequest | `tests/unit/ai.test.ts` |
| testReadingQueueCrossesChapters, testSpeechEngineReplaysSavedAudioWithoutSynthesis, testConcurrentSpeechRequestsShareOneSynthesis | `tests/unit/speech.test.ts` (описові назви українською) |
| testReadingPositionPersists | `tests/unit/storage.test.ts` |
| testAutoHideThresholdUnitsAndLabels | `tests/unit/format.test.ts` (підписи); висота рядка — e2e `reader.spec.ts` |
| testBookFontsAreInstalledAndSettingsHaveCurrentDefaults | `tests/unit/reader-model.test.ts` (налаштування); наявність шрифтів — лише на iPad (T61) |
| testParallelTranslationStartsOnTapAndReusesParagraphCache, testLateTranslationKeepsNewSentenceActive, testHidingTranslationDoesNotReopenAfterResponse, testReaderSavesWordAndFragmentAndShowsPlace, testFragmentTextFollowsWordBoundariesAcrossSentences, testSelectionReplacesSentenceTranslatesOnceAndCaches, testFragmentStopsGrowingAtLimit, testClearedFragmentIgnoresLateTranslation, testFragmentSpeechUsesSavedAudio, testLongPressSpeaksOnlyTranslatedActiveSentenceAndReplaysCache, testChangingSentenceStopsPendingSpeech, testReplayWithoutSavedAudioDoesNotSynthesize | `tests/unit/reader-model.test.ts` |
| testFragmentUsesAppleFallbackAndReportsKeyErrors | `tests/unit/reader-model.test.ts` — лише частина про помилки ключа й мережі (V-01) |
| testSavedWordsMergeContextsByLemmaAndPersist, testSavedQuotesAreUniqueAndExportEscapes, testOldSavedWordsDecodeWithoutTrainingFields | `tests/unit/saved.test.ts` |
| testAutomaticSetOrderAndLevels, testTrainingOptionsAvoidDuplicatesAndOwnMeanings, testTrainingSessionMistakesRepeatsAndResults, testReorderWrongMoveCountsAndSkipLeavesNoResult, testReorderKeyboardPlacesLettersLeftToRight, testReorderKeyboardAcceptsTheWholeWord, testReorderKeyboardAlwaysStartsFromTheFirstLetterAndFlashes | `tests/unit/training.test.ts` |
| testExternalDictionaryURLs, testDictionaryOrderAndEnabledSetPersist | `tests/unit/dictionaries.test.ts` |
| LiveOpenAITests (9): testTranslatesParagraphSentenceBySentence, testFragmentIsTranslatedWithContext, testWordCardHasLevelAndIrregularForms, testExplanationIsUkrainian, testWordCardUsesContext, testInvalidKeyIsReportedClearly, testSpeechReturnsPlayableAudio, testSentenceAudioIsSynthesizedOnceAndReplayedFromCache, testTrainingWordsAudioIsPreparedOnce | `tests/live/ai.live.test.ts` — переклад, фрагмент, картки, пояснення; **аудіо й недійсний ключ ще не перенесено**, прогін — лише з дозволом (T55) |

**Не переносяться (V-01, немає Apple Translation у Safari):** testMissingKeyAndOfflineUseAppleFallbackWithSeparateCache, testOtherErrorsAndDisabledSettingDoNotUseApple, testUnavailableAppleKeepsAIErrorWithExplanation, testAppleTranslationIsReplacedByAIWhenAIWorksAgain.

Підсумок: з 60 придатних модульних (64 − 4 Apple) перенесено 57 повністю й частково; 3 живі аудіо/ключ — відкрито. Частка ≥ 90 % (SC-02).

## UI (18)

| Тест Swift | Тест PWA |
|---|---|
| testTranslationToggleKeepsOriginal, testParallelTranslationUsesStablePanelAndSecondTapOpensWord, testMissingKeyIsExplained, testLongPressSpeaksTranslatedSentenceAndReplaysSavedAudio, testAutoHideUsesLineThreshold, testParagraphPositionRestoredAfterRelaunch, testParallelTranslationSettingsPersist, testFragmentSelectionTranslatesSpeaksAndCopies | `tests/e2e/reader.spec.ts` |
| testReaderPanelSettingsApplyAndPersist | `tests/e2e/reader-panel.spec.ts` |
| testDictionaryTranslationCardAndSettings | `tests/e2e/word-card.spec.ts` |
| testSavedWordsAndQuotes | `tests/e2e/saved.spec.ts` |
| testTrainingSessionWithMistakesAndSummary, testTrainingKeyboardShortcuts, testPronunciationExercise, testPronunciationReferencePlaysTwiceForEveryWord | `tests/e2e/training.spec.ts` |
| testImportedEPUBOpens | `tests/e2e/library.spec.ts` (синтетичний EPUB) |
| testLiveReadingScenario | не перенесено — платний живий сценарій (T55) |
| testAppleOfflineFallbackIsLabelled | не переноситься (V-01) |

Додатково, без відповідника в Swift: `smoke`, `gallery`, `ai-services`, `offline` (Chromium), частина `library`.
