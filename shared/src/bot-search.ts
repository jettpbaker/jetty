// search_wiki and search_threads: Jetty MCP tools for bots only, so their results reach the bot's
// agent and never the client. The descriptions are Jett's wording, verbatim.

export const SEARCH_WIKI_DESCRIPTION =
  'Hybrid search over your wiki home (pages, logs, brief): BM25 keyword scores merged with EmbeddingGemma embedding similarity. Returns the top k chunks (default 5), each with its path and line range.'

export const SEARCH_THREADS_DESCRIPTION =
  "Hybrid search over your chat and your workers' threads: BM25 keyword scores merged with EmbeddingGemma embedding similarity. Returns the top k message chunks (default 5), each with its thread, author and date. Older results may since have changed."

export const SEARCH_DEFAULT_K = 5
export const SEARCH_MAX_K = 20
export const SEARCH_QUERY_MAX = 1000

// Both tools take { query, k? }.
export type SearchInput = { query: string; k?: number }

export type WikiSearchHit = {
  // Relative to the bot's home, e.g. 'pages/release-process.md'.
  path: string
  startLine: number
  endLine: number
  // 0.7 × cosine + 0.3 × squashed BM25, rounded to 3 places.
  score: number
  text: string
}

export type ThreadSearchHit = {
  // The bot's own id for its chat; read_thread takes it with messageId.
  threadId: string
  // 'your chat', or the thread's title now.
  thread: string
  // jetty://threads/<id>; left out for the bot's own chat, which has no thread page.
  link?: string
  archived?: true
  messageId: string
  // The user's name, a bot's name, or the title of the thread that wrote it.
  author: string
  // The bot stamp's format without brackets: 'Thu, 8 Oct 2026, 15:41'.
  date: string
  score: number
  text: string
}

// The tool result, as JSON text. An empty index gives no results, not an error.
export type SearchResults<Hit> = { results: readonly Hit[] }
