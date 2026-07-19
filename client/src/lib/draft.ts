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

// New drafts default to the last project the user actually picked.
const LAST_PROJECT_KEY = 'jetty:last-project'

export function loadLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

export function saveLastProjectId(projectId: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId)
  } catch {
    // storage unavailable
  }
}
