import { expect, test } from 'bun:test'

import { bm25Scores } from './bm25'
import { CHUNK_MAX, CHUNK_MIN, chunkFile } from './chunk'

test('prose chunks keep headings apart and drop frontmatter', () => {
  const alpha = 'Alpha ships on a fixed afternoon and the note stays on this page. '.repeat(8)
  const beta = 'Beta used to ship at the end of the week and that note stays in history. '.repeat(8)
  const content = `---
tags: [release, process]
updated: 2026-10-01
---

# Release process

${alpha.trim()}

## History

${beta.trim()}
`
  const chunks = chunkFile('pages/release-process.md', content)
  expect(chunks.length).toBe(2)
  expect(chunks[0]!.text).toContain('Alpha ships')
  expect(chunks[0]!.text).not.toContain('Beta used')
  expect(chunks[0]!.text).not.toContain('tags:')
  expect(chunks[0]!.startLine).toBe(6)
  expect(chunks[1]!.text).toContain('Beta used')
  expect(chunks[1]!.text.startsWith('## History')).toBe(true)
  expect(chunks[0]!.text.length).toBeGreaterThanOrEqual(CHUNK_MIN)
  expect(chunks[0]!.text.length).toBeLessThanOrEqual(CHUNK_MAX)
  expect(chunks[0]!.context).toContain('Tags: release, process')
  expect(chunks[0]!.title).toBe('Release process')
})

test('long prose splits inside the size window', () => {
  const paragraph = Array.from(
    { length: 40 },
    (_, i) => `Sentence ${i} talks about widgets and the queue.`
  ).join(' ')
  const content = `# Notes\n\n${paragraph}\n`
  const chunks = chunkFile('pages/notes.md', content)
  expect(chunks.length).toBeGreaterThan(1)
  for (const chunk of chunks) {
    expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX)
    expect(chunk.text.length).toBeGreaterThan(0)
  }
  const joined = chunks.map((chunk) => chunk.text).join(' ')
  expect(joined).toContain('Sentence 0')
  expect(joined).toContain('Sentence 39')
})

test('log entries are one bullet, with indented continuations kept', () => {
  const content = `# 2026-09-22

- first thing happened
  and it continued

- second thing happened
`
  const chunks = chunkFile('log/2026-09-22.md', content)
  expect(chunks.map((chunk) => chunk.text)).toEqual([
    '- first thing happened\n  and it continued',
    '- second thing happened',
  ])
  expect(chunks[0]!.title).toBe('log 2026-09-22')
  expect(chunks[0]!.startLine).toBe(3)
  expect(chunks[0]!.endLine).toBe(4)
})

test('index items are one chunk each', () => {
  const content = `# Index

## release

- [Release process](pages/release-process.md): who cuts the release

## people

- [Mira](pages/contact-mira.md): how to reach her
`
  const chunks = chunkFile('index.md', content)
  expect(chunks.length).toBe(2)
  expect(chunks[0]!.text).toContain('Release process')
  expect(chunks[0]!.context).toContain('Section: release')
  expect(chunks[1]!.context).toContain('Section: people')
  expect(chunks[0]!.startLine).toBe(5)
})

test('bm25 ranks the chunk with the shared rare terms first', () => {
  const docs = [
    'Mira cuts the Tuesday release and posts the tag',
    'Sam cut the Friday release before August',
    'the release checklist is a template',
  ]
  const scores = bm25Scores('who cuts the Tuesday release', docs)
  expect(scores[0]!).toBeGreaterThan(scores[1]!)
  expect(scores[0]!).toBeGreaterThan(scores[2]!)
})
