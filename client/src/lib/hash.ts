// FNV-1a: a fast 32-bit string hash for seeds and cache keys, not for security.
export function fnv1a(text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// A cache key that changes whenever the text does.
export function contentKey(text: string) {
  return `${text.length.toString(36)}.${fnv1a(text).toString(36)}`
}
