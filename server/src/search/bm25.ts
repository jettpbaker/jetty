const STOP = new Set(
  `a an the of to and or for in on at by with from is are was were be been it this that these those as do does did what which who whom whose when where why how we our you your they their i me my not no yes about into over after before than then so if but just can its also them he she his her`.split(
    /\s+/
  )
)

const K1 = 1.2
const B = 0.75
// A strong rare-term match on a short chunk lands around 6–12.
// Squashing against a fixed k keeps a weak max from becoming 1.
const SQUASH_K = 8

export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const out: string[] = []
  for (const token of raw) {
    if (token.length < 2) continue
    const norm = stem(token)
    if (STOP.has(norm) || STOP.has(token)) continue
    out.push(norm)
  }
  return out
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

export function bm25Scores(query: string, docs: string[]): number[] {
  const queryTokens = [...new Set(tokenize(query))]
  const docTokens = docs.map(tokenize)
  const docCount = docs.length
  const avgDocLength = docTokens.reduce((sum, tokens) => sum + tokens.length, 0) / (docCount || 1)
  const docFrequency = new Map<string, number>()
  for (const tokens of docTokens) {
    for (const token of new Set(tokens)) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1)
    }
  }

  return docTokens.map((tokens) => {
    const termFrequency = new Map<string, number>()
    for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1)
    const docLength = tokens.length
    let score = 0
    for (const term of queryTokens) {
      const freq = termFrequency.get(term) ?? 0
      if (freq === 0) continue
      const n = docFrequency.get(term) ?? 0
      const idf = Math.log(1 + (docCount - n + 0.5) / (n + 0.5))
      const denom = freq + K1 * (1 - B + (B * docLength) / (avgDocLength || 1))
      score += idf * ((freq * (K1 + 1)) / denom)
    }
    return score
  })
}

export function squashBm25(score: number): number {
  if (score <= 0) return 0
  return score / (score + SQUASH_K)
}
