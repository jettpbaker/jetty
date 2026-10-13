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

export function bm25TokenScores(
  queryTokens: readonly string[],
  docTokens: readonly (readonly string[])[]
): number[] {
  const docCount = docTokens.length
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

export function bm25Scores(query: string, docs: string[]): number[] {
  return bm25TokenScores([...new Set(tokenize(query))], docs.map(tokenize))
}

export function squashBm25(score: number): number {
  if (score <= 0) return 0
  return score / (score + SQUASH_K)
}

// What the archived-threads page matches, heaviest first. Message text is the same
// prose the bot search indexes; the rest is the metadata that search doesn't.
const fieldWeight = { title: 8, project: 4, branch: 5, pr: 6, messages: 1 } as const
const searchFields = ['title', 'project', 'branch', 'pr', 'messages'] as const

export type ArchivedSearchFields = Record<(typeof searchFields)[number], string>

export type ArchivedSearchDoc = {
  prefix: Record<(typeof searchFields)[number], readonly string[]>
  bm25: readonly string[]
}

function contentTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem)
}

function unique(tokens: readonly string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

// A stop word has to match a whole token, so "the" doesn't prefix-match "thread".
function tokenHits(wanted: string, have: readonly string[]) {
  if (STOP.has(wanted)) return have.some((token) => token === wanted)
  return have.some((token) => token.startsWith(wanted))
}

export function prepareArchivedSearch(fields: ArchivedSearchFields): ArchivedSearchDoc {
  const prefix = {
    title: contentTokens(fields.title),
    project: contentTokens(fields.project),
    branch: contentTokens(fields.branch),
    pr: contentTokens(fields.pr),
    messages: contentTokens(fields.messages),
  }
  return {
    prefix,
    bm25: tokenize(
      [fields.title, fields.project, fields.branch, fields.pr, fields.messages].join('\n')
    ),
  }
}

// Zero is no match. An empty query matches nothing here; the page lists everything on its own.
export function scoreArchivedSearch(query: string, docs: readonly ArchivedSearchDoc[]): number[] {
  const wanted = unique(contentTokens(query.trim().toLowerCase()))
  if (!wanted.length) return docs.map(() => 0)
  const bm25 = bm25TokenScores(
    [...new Set(tokenize(query))],
    docs.map((doc) => doc.bm25)
  )
  return docs.map((doc, index) => {
    const all = searchFields.flatMap((name) => doc.prefix[name])
    if (!wanted.every((token) => tokenHits(token, all))) return 0
    let score = bm25[index] ?? 0
    for (const token of wanted) {
      for (const name of searchFields) {
        const have = doc.prefix[name]
        if (have.some((candidate) => candidate === token)) score += fieldWeight[name] * 3
        else if (!STOP.has(token) && have.some((candidate) => candidate.startsWith(token)))
          score += fieldWeight[name]
      }
    }
    return score
  })
}

function findToken(text: string, token: string) {
  const lower = text.toLowerCase()
  const exact = STOP.has(token)
  let from = 0
  while (from < lower.length) {
    const at = lower.indexOf(token, from)
    if (at < 0) return -1
    const before = at === 0 || !/[a-z0-9]/.test(lower[at - 1] ?? '')
    const after = lower[at + token.length]
    if (before && (!exact || !after || !/[a-z0-9]/.test(after))) return at
    from = at + 1
  }
  return -1
}

const visibleFields = ['title', 'project', 'branch', 'pr'] as const

// A short excerpt when the query needed the message text. Undefined when the title,
// project, branch or PR already show why the row matched. Uses the prepared tokens,
// so a keystroke doesn't retokenize the message text.
export function archivedMessageSnippet(
  query: string,
  messages: string,
  doc: ArchivedSearchDoc
): string | undefined {
  const wanted = unique(contentTokens(query.trim().toLowerCase()))
  if (!wanted.length || !messages) return undefined
  const needsMessage = wanted.some(
    (token) =>
      tokenHits(token, doc.prefix.messages) &&
      !visibleFields.some((name) => tokenHits(token, doc.prefix[name]))
  )
  if (!needsMessage) return undefined
  let at = -1
  for (const token of wanted) {
    const found = findToken(messages, token)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  if (at < 0) return undefined
  const start = Math.max(0, at - 28)
  const end = Math.min(messages.length, at + 72)
  const slice = messages.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${end < messages.length ? '…' : ''}`
}

export type ArchivedMessageHit = {
  id: string
  exact: readonly string[]
  prefix: readonly string[]
  bm25: number
  snippet: string
}

// Unique tokens are enough for exact and prefix hits. BM25 keeps every occurrence.
export function prepareArchivedMessage(text: string) {
  return { tokens: unique(contentTokens(text)), bm25: tokenize(text) }
}

function messageExcerpt(text: string, tokens: readonly string[]) {
  let at = -1
  for (const token of tokens) {
    const found = findToken(text, token)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  if (at < 0) return ''
  const start = Math.max(0, at - 28)
  const end = Math.min(text.length, at + 72)
  const slice = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`
}

// Threads whose messages cover at least one query token. The page merges these
// with the metadata it already scored locally.
export function matchArchivedMessages(
  query: string,
  docs: readonly { id: string; text: string; tokens: readonly string[]; bm25: readonly string[] }[]
): ArchivedMessageHit[] {
  const wanted = unique(contentTokens(query.trim().toLowerCase()))
  if (!wanted.length || docs.length === 0) return []
  const bm25 = bm25TokenScores(
    [...new Set(tokenize(query))],
    docs.map((doc) => doc.bm25)
  )
  const hits: ArchivedMessageHit[] = []
  for (let index = 0; index < docs.length; index++) {
    const doc = docs[index]
    if (!doc) continue
    const exact: string[] = []
    const prefix: string[] = []
    for (const token of wanted) {
      if (doc.tokens.some((candidate) => candidate === token)) exact.push(token)
      else if (!STOP.has(token) && doc.tokens.some((candidate) => candidate.startsWith(token)))
        prefix.push(token)
    }
    if (exact.length === 0 && prefix.length === 0) continue
    hits.push({
      id: doc.id,
      exact,
      prefix,
      bm25: bm25[index] ?? 0,
      snippet: messageExcerpt(doc.text, [...exact, ...prefix]),
    })
  }
  return hits
}

function messageCovers(hit: ArchivedMessageHit | undefined, token: string) {
  return hit !== undefined && (hit.exact.includes(token) || hit.prefix.includes(token))
}

// Metadata is already in `docs` (messages left empty). `hits` is the server's
// message matches, keyed by the same order as `ids`. A row matches when every
// query token hits metadata or messages. BM25 on each side is only a tiebreak.
export function rankArchivedSearch(
  query: string,
  docs: readonly ArchivedSearchDoc[],
  hits: ReadonlyMap<string, ArchivedMessageHit>,
  ids: readonly string[]
): { score: number; snippet?: string }[] {
  const wanted = unique(contentTokens(query.trim().toLowerCase()))
  if (!wanted.length) return docs.map(() => ({ score: 0 }))
  const bm25 = bm25TokenScores(
    [...new Set(tokenize(query))],
    docs.map((doc) => doc.bm25)
  )
  return docs.map((doc, index) => {
    const hit = hits.get(ids[index] ?? '')
    const covered = wanted.every(
      (token) =>
        visibleFields.some((name) => tokenHits(token, doc.prefix[name])) ||
        messageCovers(hit, token)
    )
    if (!covered) return { score: 0 }
    let score = (bm25[index] ?? 0) + (hit?.bm25 ?? 0)
    for (const token of wanted) {
      for (const name of visibleFields) {
        const have = doc.prefix[name]
        if (have.some((candidate) => candidate === token)) score += fieldWeight[name] * 3
        else if (!STOP.has(token) && have.some((candidate) => candidate.startsWith(token)))
          score += fieldWeight[name]
      }
      if (hit?.exact.includes(token)) score += fieldWeight.messages * 3
      else if (hit?.prefix.includes(token)) score += fieldWeight.messages
    }
    const snippet =
      hit?.snippet &&
      wanted.some(
        (token) =>
          messageCovers(hit, token) &&
          !visibleFields.some((name) => tokenHits(token, doc.prefix[name]))
      )
        ? hit.snippet
        : undefined
    return snippet ? { score, snippet } : { score }
  })
}
