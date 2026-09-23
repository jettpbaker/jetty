import { object, string } from './stdio-rpc'

export type ApprovalChange = { path: string; diff?: string; before?: string; after?: string }

export function approvalChanges(toolName: string, input: unknown): ApprovalChange[] {
  const data = object(input)
  if (Array.isArray(data.changes)) {
    return data.changes.map(object).flatMap((change): ApprovalChange[] => {
      const path = string(change.path) || string(change.file_path)
      const diff = string(change.diff) || string(change.patch)
      if (!path || !diff) return []
      // Codex sends a whole added or deleted file's contents in `diff`.
      const kind = string(object(change.kind).type)
      if (kind === 'add') return [{ path, after: diff }]
      if (kind === 'delete') return [{ path, before: diff }]
      return [{ path, diff }]
    })
  }
  const path = string(data.file_path) || string(data.path)
  const diff = string(data.diff) || string(data.patch)
  if (path && diff) return [{ path, diff }]
  const name = toolName.toLowerCase()
  if (!name.includes('edit') && !name.includes('write')) return []
  if (!path) return []
  const edits = name === 'multiedit' && Array.isArray(data.edits) ? data.edits.map(object) : [data]
  return edits.flatMap((edit) => {
    const before = string(edit.old_string)
    const after = typeof edit.new_string === 'string' ? edit.new_string : edit.content
    return typeof after === 'string' || typeof edit.old_string === 'string'
      ? [{ path, ...(typeof edit.old_string === 'string' ? { before } : {}), after: string(after) }]
      : []
  })
}
