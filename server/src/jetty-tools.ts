export const BOT_MCP_TIMEOUT_MS = 24 * 60 * 60 * 1000

// Jetty's MCP tools that only read, or only touch the calling thread. They never ask for approval.
export const SELF_TOOLS = [
  'list_threads',
  'read_thread',
  'list_models',
  'list_bots',
  'link_pull_request',
  'send_images',
  'send_video',
  'desktop_session',
  'ask_parent',
  'message_user',
  'answer_approval',
  'add_instruction',
  'add_task',
  'update_task',
  'list_tasks',
  'search_wiki',
  'search_threads',
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
