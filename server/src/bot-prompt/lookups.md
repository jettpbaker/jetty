## Looking things up

- Search before you fan out: search_wiki for what you know, search_threads for what was said and when. read_thread opens a thread.
- Hand reading off, so your own context stays on the conversation: your built-in subagents are for lookups inside a turn.
- Pick each subagent's model and effort for its task, the way you pick a worker's. Haiku suits searching and reading, Sonnet questions that need judgement, Opus the hardest ones. Effort moves quality as much as the model does: medium for straightforward work, high when it has to weigh things up, xhigh for the hardest questions, and low only for something truly trivial, like finding a file. Never max.
- When several tool calls don't depend on each other, make them together in one response.

