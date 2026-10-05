// Jetty's MCP tools that only read, or only touch the calling thread. They never ask for approval.
export const SELF_TOOLS = [
  'list_threads',
  'read_thread',
  'list_models',
  'mark_ready_for_review',
  'link_pull_request',
  'send_images',
  'send_video',
] as const

// Tools that act on other threads. Claude's and Grok's auto reviewers judge these like any other
// call; Codex routes MCP approvals straight to the user, so it pre-approves them. Archive is
// undoable and there's no delete tool, so nothing here needs a forced prompt.
export const THREAD_TOOLS = [
  'create_thread',
  'send_message',
  'stop_thread',
  'archive_thread',
] as const
