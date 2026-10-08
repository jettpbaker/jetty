import type { ResultOf } from '@jetty/shared/wire'

import {
  hydratePartialDiff,
  parsePatchFiles,
  type FileDiffLoadedFiles,
  type FileDiffMetadata,
} from '@pierre/diffs'

export type FileChange = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  diff: FileDiffMetadata
}

export type LoadDiffFile = (
  path: string,
  prevPath?: string
) => Promise<ResultOf<'thread.diffFile'> | { unavailable: 'missing' }>

const statuses = {
  change: 'modified',
  new: 'added',
  deleted: 'deleted',
  'rename-pure': 'renamed',
  'rename-changed': 'renamed',
} as const

// The diff worker pool caches a file's highlighting by its key, so a key must change with the
// content. Git's index line names both blobs; a patch without one (GitHub's) can pass a prefix
// that changes whenever it does.
export function parseFileChanges(patch: string, cacheKey?: string): FileChange[] {
  return parsePatchFiles(patch, cacheKey).flatMap(({ files }) =>
    files.map((diff) => {
      if (diff.prevObjectId && diff.newObjectId)
        diff.cacheKey ??= `${diff.prevName ?? diff.name}:${diff.name}:${diff.prevObjectId}..${diff.newObjectId}`
      return { path: diff.name, status: statuses[diff.type], diff }
    })
  )
}

const diffIds = new WeakMap<FileDiffMetadata, number>()
let lastDiffId = 0

// CodeView only re-reads an item when its version changes, so each diff object gets its own.
export function diffId(diff: FileDiffMetadata) {
  let id = diffIds.get(diff)
  if (id === undefined) {
    id = ++lastDiffId
    diffIds.set(diff, id)
  }
  return id
}

export function diffItem(id: string, fileDiff: FileDiffMetadata, collapsed: boolean) {
  return {
    id,
    type: 'diff' as const,
    fileDiff,
    collapsed,
    version: diffId(fileDiff) * 2 + Number(collapsed),
  }
}

export function loadedFiles(
  diff: FileDiffMetadata,
  contents: { before: string | null; after: string | null }
): FileDiffLoadedFiles {
  const newFile = { name: diff.name, contents: contents.after ?? '' }
  if (diff.type === 'rename-pure') return { oldFile: null, newFile }
  return { oldFile: { name: diff.prevName ?? diff.name, contents: contents.before ?? '' }, newFile }
}

export function hydratedDiff(diff: FileDiffMetadata, files: FileDiffLoadedFiles) {
  return diff.isPartial ? hydratePartialDiff('clone', diff, files) : diff
}

export function patchMatchesContents(
  diff: FileDiffMetadata,
  contents: { before: string | null; after: string | null }
) {
  if (contents.before === null || contents.after === null) return false
  const before = contents.before.split(/(?<=\n)/)
  const after = contents.after.split(/(?<=\n)/)
  for (const hunk of diff.hunks) {
    for (let index = 0; index < hunk.deletionCount; index++)
      if (
        diff.deletionLines[hunk.deletionLineIndex + index] !==
        before[hunk.deletionStart - 1 + index]
      )
        return false
    for (let index = 0; index < hunk.additionCount; index++)
      if (
        diff.additionLines[hunk.additionLineIndex + index] !== after[hunk.additionStart - 1 + index]
      )
        return false
  }
  return true
}

// Some of a parsed diff's hunks as patch text, so a file diffed from its contents can show only them.
export function hunksPatch(diff: FileDiffMetadata, indexes: readonly number[]) {
  const line = (text: string | undefined) => (text ?? '').replace(/\n$/, '')
  const noNewline = '\\ No newline at end of file'
  const rows: string[] = []
  for (const index of indexes) {
    const hunk = diff.hunks[index]
    if (!hunk) continue
    rows.push(
      `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${hunk.hunkContext ? ` ${hunk.hunkContext}` : ''}`
    )
    for (const [position, content] of hunk.hunkContent.entries()) {
      const end = position === hunk.hunkContent.length - 1
      if (content.type === 'context') {
        for (let i = 0; i < content.lines; i++)
          rows.push(` ${line(diff.additionLines[content.additionLineIndex + i])}`)
        if (end && hunk.noEOFCRAdditions) rows.push(noNewline)
        continue
      }
      for (let i = 0; i < content.deletions; i++)
        rows.push(`-${line(diff.deletionLines[content.deletionLineIndex + i])}`)
      if (end && content.deletions && hunk.noEOFCRDeletions) rows.push(noNewline)
      for (let i = 0; i < content.additions; i++)
        rows.push(`+${line(diff.additionLines[content.additionLineIndex + i])}`)
      if (end && content.additions && hunk.noEOFCRAdditions) rows.push(noNewline)
    }
  }
  return rows.join('\n')
}

// @pierre/diffs only offers context expansion on `change`/`rename-changed` diffs, so posing as a
// pure rename drops the expand buttons. Diffs that share a cache key are the same diff to it, so
// the copy takes its own.
export function withoutContext(diff: FileDiffMetadata): FileDiffMetadata {
  return {
    ...diff,
    type: 'rename-pure',
    cacheKey: diff.cacheKey && `${diff.cacheKey}:no-context`,
  }
}
