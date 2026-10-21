// Port of EnglishReaderApp.swift: start-up, test resets, routing between library, reader and training.
import { useEffect, useState } from 'preact/hooks'
import { effect } from '@preact/signals'
import { aiServicesOpen, closeTraining, route, trainingOpen } from './router.ts'
import { testFlags } from './test-mode.ts'
import { addBook, books, initLibrary, lastError, resetAll, seedDemoIfNeeded } from '../core/storage/library.ts'
import { initKey } from '../core/storage/key.ts'
import { initSaved, removeAllForTests, seedForTests } from '../core/saved/saved.ts'
import { requestPersistence } from '../core/storage/db.ts'
import { settings } from '../core/storage/settings.ts'
import { importBook, importFile } from '../core/import/importer.ts'
import { warmUpVoices } from '../core/speech/system-speech.ts'
import { applyTheme } from '../ui/theme/themes.ts'
import { LibraryScreen } from '../ui/library/LibraryScreen.tsx'
import { ReaderScreen } from '../ui/reader/ReaderScreen.tsx'
import { TrainingScreen } from '../ui/training/TrainingScreen.tsx'
import { AIServices } from '../ui/settings/AIServices.tsx'
import { Gallery } from '../ui/Gallery.tsx'
import { errorMessage } from '../contracts.ts'
import { InstallHint } from './InstallHint.tsx'

effect(() => applyTheme(settings.theme.value))

async function loadDemo() {
  const response = await fetch('./demo.md')
  if (!response.ok) return null
  return importBook(new Uint8Array(await response.arrayBuffer()), 'md', 'Demo')
}

async function start() {
  if (__TEST_MODE__ && testFlags.reset) {
    await resetAll()
    removeAllForTests()
  }
  await Promise.all([initLibrary(), initKey(), initSaved()])
  if (__TEST_MODE__ && testFlags.reset && testFlags.savedWords) seedForTests()
  if (__TEST_MODE__ && testFlags.voice) settings.voiceEngine.value = testFlags.voice
  await seedDemoIfNeeded(loadDemo)
  if (__TEST_MODE__ && testFlags.importPath) {
    try {
      const response = await fetch(testFlags.importPath)
      const blob = await response.blob()
      const name = testFlags.importPath.split('/').pop() ?? 'book'
      await addBook(await importFile(new File([blob], name)))
    } catch (error) {
      lastError.value = errorMessage(error)
    }
  }
  void requestPersistence()
  warmUpVoices()
}

const showGallery = __TEST_MODE__ && new URLSearchParams(location.search).has('gallery')

export function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!showGallery) void start().finally(() => setReady(true))
  }, [])

  if (showGallery) return <Gallery />
  if (!ready) return null

  const current = route.value
  const reader = current.screen === 'reader' && books.value.some((b) => b.id === current.bookID)
  return (
    <>
      {reader ? <ReaderScreen key={current.bookID} bookID={current.bookID} /> : <><LibraryScreen /><InstallHint /></>}
      {trainingOpen.value && <TrainingScreen onClose={closeTraining} />}
      <AIServices open={aiServicesOpen.value} onClose={() => { aiServicesOpen.value = false }} />
    </>
  )
}
