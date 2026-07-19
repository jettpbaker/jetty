const key = (id: string) => `jetty:draft:${id}`

export function loadDraft(id: string): string {
  try {
    return localStorage.getItem(key(id)) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(id: string, text: string) {
  try {
    if (text) localStorage.setItem(key(id), text)
    else localStorage.removeItem(key(id))
  } catch {
    // storage unavailable (private mode / quota); the draft just won't persist
  }
}

export function removeDraft(id: string) {
  try {
    localStorage.removeItem(key(id))
  } catch {
    // storage unavailable
  }
}

export function clearDraft(id: string) {
  removeDraft(id)
}
