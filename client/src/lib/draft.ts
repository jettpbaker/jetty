const key = (projectId: string) => `jetty:draft:${projectId}`

export function loadDraft(projectId: string): string {
  try {
    return localStorage.getItem(key(projectId)) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(projectId: string, text: string) {
  try {
    if (text) localStorage.setItem(key(projectId), text)
    else localStorage.removeItem(key(projectId))
  } catch {
    // storage unavailable (private mode / quota); the draft just won't persist
  }
}

export function clearDraft(projectId: string) {
  saveDraft(projectId, '')
}
