import type { PullRequestGuide } from '@jetty/shared/wire'

import type { PrFile } from './adapter'

// Some of a file's hunks: their patch text, or for a file whose patch loads later, their indexes.
// A part with neither shows the whole file.
export type GuidePart = { file: PrFile; patch?: string; hunks?: readonly number[] }

export type GuideSection = { number?: number; title: string; why: string; parts: GuidePart[] }

type GuideFile = PullRequestGuide['unplaced'][number]

// `@@` blocks, in the order chapter indexes refer to.
export function patchHunks(patch: string | undefined) {
  if (!patch) return []
  return patch.split(/^(?=@@ )/m).filter((hunk) => hunk.startsWith('@@'))
}

function guideParts(files: ReadonlyMap<string, PrFile>, entries: readonly GuideFile[]) {
  const parts: GuidePart[] = []
  for (const entry of entries) {
    const file = files.get(entry.path)
    if (!file) continue
    const hunks = [...entry.hunks].sort((a, b) => a - b)
    if (file.patchDeferred) {
      parts.push({ file, hunks })
      continue
    }
    const patches = patchHunks(file.patch)
    const patch = hunks
      .flatMap((index) => patches[index] ?? [])
      .map((hunk) => hunk.replace(/\n$/, ''))
      .join('\n')
    parts.push({ file, patch })
  }
  return parts
}

// Each chapter, tests and generated files last, then what the guide leaves out: the hunks it didn't
// place and any file it never names (binary and empty ones), whole. Hide generated drops the
// generated chapters before numbering.
export function guideSections(
  files: readonly PrFile[],
  guide: PullRequestGuide,
  hideGenerated: boolean
): GuideSection[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const last = (kind: string) => kind === 'tests' || kind === 'generated'
  const chapters = [
    ...guide.chapters.filter((chapter) => !last(chapter.kind)),
    ...guide.chapters.filter((chapter) => last(chapter.kind)),
  ].filter((chapter) => !hideGenerated || chapter.kind !== 'generated')
  const sections: GuideSection[] = chapters.map((chapter, index) => ({
    number: index + 1,
    title: chapter.title,
    why: chapter.why,
    parts: guideParts(byPath, chapter.files),
  }))
  const named = new Set(
    [...guide.chapters.flatMap((chapter) => chapter.files), ...guide.unplaced].map(
      (entry) => entry.path
    )
  )
  const rest = [
    ...guideParts(byPath, guide.unplaced),
    ...files.filter((file) => !named.has(file.path)).map((file) => ({ file, patch: file.patch })),
  ]
  if (rest.length) sections.push({ title: 'Not in the guide', why: '', parts: rest })
  return sections
}

// A guide card is viewed on its own, so a file split over two chapters can be done in one and not the
// other.
export function partKey(section: number, path: string) {
  return `${section}:${path}`
}
