export type SlashQuery = {
  start: number
  end: number
  query: string
  atStart: boolean
}

export type SlashToken = { start: number; end: number; name: string }

export function activeSlash(text: string, caret: number): SlashQuery | undefined {
  const before = text.slice(0, caret)
  let end = caret
  while (end < text.length && !/\s/.test(text.charAt(end))) end++
  const match = /(^|\s)\/([\w-]*)$/.exec(before)
  if (!match) return undefined
  const [, lead = '', query = ''] = match
  const start = match.index + lead.length
  return { start, end, query, atStart: !text.slice(0, start).trim() }
}

export function slashTokens(text: string): SlashToken[] {
  return [...text.matchAll(/(^|\s)\/([\w-]+)(?=\s|$)/g)].map((match) => {
    const [, lead = '', name = ''] = match
    const start = match.index + lead.length
    return { start, end: start + name.length + 1, name }
  })
}

function isSubsequence(query: string, text: string) {
  let index = 0
  for (const char of text) if (char === query[index]) index++
  return index === query.length
}

// Higher is better; undefined means no match. Descriptions only count from three characters, so short queries stay on names.
export function matchScore(name: string, description: string, query: string): number | undefined {
  const q = query.toLowerCase()
  if (!q) return 0
  const n = name.toLowerCase()
  if (n.startsWith(q)) return 400 - n.length
  if (n.split(/[-\s.]/).some((part) => part.startsWith(q))) return 300 - n.length
  if (n.includes(q)) return 200 - n.length
  if (isSubsequence(q, n)) return 100 - n.length
  if (
    q.length >= 3 &&
    description
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(q))
  )
    return 50
  return undefined
}
