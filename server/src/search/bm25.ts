import { bm25TokenScores, tokenize } from '@jetty/shared/search'

export { squashBm25 } from '@jetty/shared/search'

export function bm25Scores(query: string, docs: string[]): number[] {
  const wanted = [...new Set(tokenize(query))]
  const tokens = docs.map(tokenize)
  const exact = bm25TokenScores(wanted, tokens)
  const partial = bm25TokenScores(
    wanted,
    tokens.map((doc) =>
      doc.flatMap((token) => wanted.filter((term) => token !== term && token.startsWith(term)))
    )
  )
  return exact.map((score, i) => score + partial[i]! * 0.5)
}
