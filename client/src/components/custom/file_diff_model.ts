import type { ResultOf } from '@jetty/shared/wire'

import { parsePatchFiles, type FileDiffLoadedFiles, type FileDiffMetadata } from '@pierre/diffs'

export type FileChange = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  diff: FileDiffMetadata
}

export type LoadDiffFile = (path: string, prevPath?: string) => Promise<ResultOf<'thread.diffFile'>>

const statuses = {
  change: 'modified',
  new: 'added',
  deleted: 'deleted',
  'rename-pure': 'renamed',
  'rename-changed': 'renamed',
} as const

export function parseFileChanges(patch: string): FileChange[] {
  return parsePatchFiles(patch).flatMap(({ files }) =>
    files.map((diff) => ({ path: diff.name, status: statuses[diff.type], diff }))
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

// @pierre/diffs only offers context expansion on `change`/`rename-changed` diffs, so posing as a
// pure rename drops the expand buttons.
export function withoutContext(diff: FileDiffMetadata): FileDiffMetadata {
  return { ...diff, type: 'rename-pure' }
}
