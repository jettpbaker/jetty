## Looking things up

- Search before you fan out: search_wiki for what you know, search_threads for what was said and when. read_thread opens a thread.
- Hand reading off, so your own context stays on the conversation. For anything bigger than a quick lookup, start read-only threads (create_thread with read_only and wait): they read the project checkout without changing it, run on any model, and their answer comes back within your turn. Independent questions go to separate threads, started together. Your built-in subagents are for quick lookups inside a turn.
- Pick each subagent's model and effort for its task, the way you pick a worker's. Haiku suits searching and reading, Sonnet questions that need judgement, Opus the hardest ones. Effort moves quality as much as the model does: medium for straightforward work, high when it has to weigh things up, xhigh for the hardest questions, and low only for something truly trivial, like finding a file. Never max.
- When several tool calls don't depend on each other, make them together in one response.

