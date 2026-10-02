// The swap point: everything the lab does to a browser goes through these functions, so
// replacing Bun.WebView (e.g. with puppeteer-core) touches only this file.
import { homedir } from 'node:os'
import { join } from 'node:path'

import chrome from './chrome.json'

export const viewport = { width: 1440, height: 900 }

const cacheRoot = join(homedir(), 'Library/Caches/jetty-perf')

export function chromePath() {
  return join(
    cacheRoot,
    `chrome/mac_arm-${chrome.version}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  )
}

export async function ensureChrome() {
  const path = chromePath()
  if (await Bun.file(path).exists()) return path
  console.log(`installing Chrome for Testing ${chrome.version}…`)
  const install = Bun.spawn(
    ['bunx', '@puppeteer/browsers', 'install', `chrome@${chrome.version}`, '--path', cacheRoot],
    { stdout: 'inherit', stderr: 'inherit' }
  )
  if ((await install.exited) !== 0 || !(await Bun.file(path).exists()))
    throw new Error(`could not install Chrome for Testing ${chrome.version}`)
  return path
}

export type Page = {
  cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  on<T = unknown>(event: string, listener: (data: T) => void): () => void
  evaluate<T = unknown>(expression: string): Promise<T>
  navigate(url: string): Promise<void>
  click(x: number, y: number): Promise<void>
  key(key: string, text?: string): Promise<void>
  close(): Promise<void>
}

// Chrome is spawned once per lab process; every page is a fresh tab in it.
export async function openPage(): Promise<Page> {
  const path = await ensureChrome()
  const view = new Bun.WebView({
    backend: {
      type: 'chrome',
      path,
      url: false,
      argv: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-extensions',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-service-autorun',
        '--password-store=basic',
        '--use-mock-keychain',
        '--hide-scrollbars',
        '--mute-audio',
      ],
    },
    ...viewport,
  })
  await view.navigate('about:blank')

  function cdp<T>(method: string, params: Record<string, unknown> = {}) {
    return view.cdp<T>(method, params)
  }

  async function mouse(type: string, x: number, y: number, clickCount = 0) {
    await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount })
  }

  return {
    cdp,
    on(event, listener) {
      const handler = (message: MessageEvent) => listener(message.data)
      view.addEventListener(event, handler as EventListener)
      return () => view.removeEventListener(event, handler as EventListener)
    },
    async evaluate<T>(expression: string) {
      const result = await cdp<{
        result: { value?: unknown }
        exceptionDetails?: { text: string; exception?: { description?: string } }
      }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
        )
      return result.result.value as T
    },
    navigate: (url) => view.navigate(url),
    async click(x, y) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await mouse('mousePressed', x, y, 1)
      await mouse('mouseReleased', x, y, 1)
    },
    async key(key, text = key === 'Enter' ? '\r' : undefined) {
      const code = text && /^[a-z]$/i.test(text) ? `Key${text.toUpperCase()}` : key
      const base = {
        key,
        code,
        windowsVirtualKeyCode: keyCodes[key] ?? text?.toUpperCase().charCodeAt(0),
      }
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    },
    async close() {
      view.close()
    },
  }
}

const keyCodes: Record<string, number> = { Enter: 13, Escape: 27, Backspace: 8, Tab: 9 }

export function closeBrowser() {
  Bun.WebView.closeAll()
}
