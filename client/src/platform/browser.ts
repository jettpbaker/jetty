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
    return `${protocol}//${location.host}/ws`
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
    get: (key) => localStorage.getItem(key) ?? undefined,
    set: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
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
