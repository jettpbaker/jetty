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
