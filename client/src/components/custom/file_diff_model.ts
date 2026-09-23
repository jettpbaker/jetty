import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'

export type FileChange = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  diff: FileDiffMetadata
}

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
