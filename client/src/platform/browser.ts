import type { Platform } from './types'

async function blobDirectory() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('jetty', { create: true })
}

function missing(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

export const browser: Platform = {
  connectionUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL(`${protocol}//${location.host}/ws`)
    const secret = document.querySelector<HTMLMetaElement>('meta[name="jetty-ws-secret"]')?.content
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
