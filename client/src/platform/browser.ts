import type { Platform, PickFilesOptions } from './types'

function connectionUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

function pickFiles({ accept, multiple = true }: PickFilesOptions = {}) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = multiple
  if (accept) input.accept = accept
  return new Promise<File[]>((resolve) => {
    input.addEventListener('change', () => resolve([...(input.files ?? [])]))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function blobName(key: string) {
  if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid blob key')
  return key
}

async function blobDirectory() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('jetty', { create: true })
}

function missing(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

export const browser: Platform = {
  connectionUrl,
  pickFiles,
  openExternal,
  storage: {
    get: (key) => localStorage.getItem(key) ?? undefined,
    set: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
  },
  blobs: {
    async get(key) {
      try {
        const handle = await (await blobDirectory()).getFileHandle(blobName(key))
        return await handle.getFile()
      } catch (error) {
        if (missing(error)) return undefined
        throw error
      }
    },
    async put(key, blob) {
      const handle = await (await blobDirectory()).getFileHandle(blobName(key), { create: true })
      const writable = await handle.createWritable()
      try {
        await writable.write(blob)
        await writable.close()
      } catch (error) {
        try {
          await writable.abort()
        } catch {
          // The original write error is the one to surface.
        }
        throw error
      }
    },
    async remove(key) {
      try {
        await (await blobDirectory()).removeEntry(blobName(key))
      } catch (error) {
        if (!missing(error)) throw error
      }
    },
  },
}
