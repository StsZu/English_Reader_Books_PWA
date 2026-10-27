// «Доступна нова версія» (specs/007-version, V2) on stand-ins for the service worker objects.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingUpdate, watchUpdates } from '../../src/app/update.ts'
import { LibraryScreen } from '../../src/ui/library/LibraryScreen.tsx'

class FakeWorker extends EventTarget {
  postMessage = vi.fn()
  constructor(public state: ServiceWorkerState) {
    super()
  }

  become(state: ServiceWorkerState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  update = vi.fn(async () => {})
}

class FakeContainer extends EventTarget {
  constructor(public controller: object | null) {
    super()
  }
}

function watch(controller: object | null = {}) {
  const registration = new FakeRegistration()
  const container = new FakeContainer(controller)
  const reload = vi.fn()
  const start = () => watchUpdates(registration as unknown as ServiceWorkerRegistration, container as unknown as ServiceWorkerContainer, reload)
  return { registration, container, reload, start }
}

beforeEach(() => { pendingUpdate.value = null })

describe('оновлення застосунку', () => {
  it('нова версія, що вже чекає, пропонується; «Оновити» → skipWaiting → одне перезавантаження після зміни', () => {
    const { registration, container, reload, start } = watch()
    registration.waiting = new FakeWorker('installed')
    start()
    expect(pendingUpdate.value).not.toBeNull()
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    pendingUpdate.value!()
    expect(registration.waiting.postMessage).toHaveBeenCalledWith('skipWaiting')
    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('версія, знайдена під час роботи, пропонується після встановлення', () => {
    const { registration, start } = watch()
    start()
    const worker = new FakeWorker('installing')
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    expect(pendingUpdate.value).toBeNull()
    worker.become('installed')
    expect(pendingUpdate.value).not.toBeNull()
  })

  it('перше встановлення (сторінкою ще ніхто не керує) не є оновленням', () => {
    const { registration, start } = watch(null)
    registration.waiting = new FakeWorker('installed')
    start()
    expect(pendingUpdate.value).toBeNull()
  })

  it('повернення з фону перевіряє оновлення', () => {
    const { registration, start } = watch()
    start()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('смужка в бібліотеці', () => {
  let root: HTMLDivElement
  beforeEach(() => {
    root = document.createElement('div')
    document.body.append(root)
  })
  afterEach(() => {
    render(null, root)
    root.remove()
  })

  it('є лише коли нова версія чекає; «Оновити» її застосовує', async () => {
    await act(() => { render(<LibraryScreen />, root) })
    expect(root.querySelector('[data-testid="updateBar"]')).toBeNull()
    const apply = vi.fn()
    await act(() => { pendingUpdate.value = apply })
    const bar = root.querySelector<HTMLElement>('[data-testid="updateBar"]')!
    expect(bar.textContent).toContain('Доступна нова версія.')
    bar.querySelector('button')!.click()
    expect(apply).toHaveBeenCalled()
  })
})
