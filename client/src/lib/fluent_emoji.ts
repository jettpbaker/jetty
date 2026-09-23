function fluentEmojiUrl(codepoints: readonly string[]) {
  return `/fluent-emoji/${codepoints.filter((code) => code !== 'fe0f').join('-')}.svg`
}

export function unifiedEmojiUrl(unified: string) {
  return fluentEmojiUrl(unified.split('-'))
}

export function emojiUrl(emoji: string) {
  return fluentEmojiUrl(
    Array.from(emoji, (char) => (char.codePointAt(0) ?? 0).toString(16).padStart(4, '0'))
  )
}
