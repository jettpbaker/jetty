import type { Platform } from './types'

async function blobDirectory() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('jetty', { create: true })
}

function missing(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function readSecret(page: Document) {
  return page.querySelector<HTMLMetaElement>('meta[name="jetty-ws-secret"]')?.content
}

let secret = readSecret(document)
const SECRET_TIMEOUT_MS = 5000

// The server mints a new secret each launch and only hands it out in the page it serves. A page
// that never finishes loading mustn't hold the reconnect: the socket tries the old secret and the
// next attempt fetches again.
async function refreshSecret() {
  try {
    const response = await fetch('/', {
      cache: 'no-store',
      signal: AbortSignal.timeout(SECRET_TIMEOUT_MS),
    })
    if (!response.ok) return
    secret =
      readSecret(new DOMParser().parseFromString(await response.text(), 'text/html')) ?? secret
  } catch {}
}

export const browser: Platform = {
  async connectionUrl(reconnecting) {
    if (reconnecting) await refreshSecret()
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL(`${protocol}//${location.host}/ws`)
    if (secret) url.searchParams.set('secret', secret)
    return url.toString()
  },
  pickFiles({ accept, multiple = true } = {}) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    if (accept) input.accept = accept
    return new Promise((resolve) => {
      input.addEventListener('change', () => resolve([...(input.files ?? [])]))
      input.addEventListener('cancel', () => resolve([]))
      input.click()
    })
  },
  storage: {
    get(key) {
      try {
        return localStorage.getItem(key) ?? undefined
      } catch {
        return undefined
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key)
      } catch {}
    },
  },
  session: {
    get(key) {
      try {
        return sessionStorage.getItem(key) ?? undefined
      } catch {
        return undefined
      }
    },
    set(key, value) {
      try {
        sessionStorage.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      try {
        sessionStorage.removeItem(key)
      } catch {}
    },
  },
  blobs: {
    async get(key) {
      try {
        const handle = await (await blobDirectory()).getFileHandle(key)
        return await handle.getFile()
      } catch (error) {
        if (missing(error)) return undefined
        throw error
      }
    },
    async put(key, blob) {
      const handle = await (await blobDirectory()).getFileHandle(key, { create: true })
      const writable = await handle.createWritable()
      try {
        await writable.write(blob)
        await writable.close()
      } catch (error) {
        await writable.abort().catch(() => {})
        throw error
      }
    },
    async remove(key) {
      try {
        await (await blobDirectory()).removeEntry(key)
      } catch (error) {
        if (!missing(error)) throw error
      }
    },
  },
}
