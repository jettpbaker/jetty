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

export const browser: Platform = {
  connectionUrl,
  pickFiles,
  openExternal,
  storage: {
    get: (key) => localStorage.getItem(key) ?? undefined,
    set: (key, value) => localStorage.setItem(key, value),
    remove: (key) => localStorage.removeItem(key),
  },
}
