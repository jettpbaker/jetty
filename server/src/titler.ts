import { query } from '@anthropic-ai/claude-agent-sdk'

export type Titler = (text: string) => Promise<string | null>

const TITLE_MODEL = 'haiku'
const MAX_TITLE_LEN = 60
const SYSTEM_PROMPT =
  'Return ONLY a concise 3–6 word title for this coding conversation. No quotes, no punctuation wrapping, no explanation.'

export function createTitler(): Titler {
  return async (text: string) => {
    try {
      const q = query({
        prompt: text,
        options: {
          model: TITLE_MODEL,
          maxTurns: 1,
          allowedTools: [],
          settingSources: [],
          systemPrompt: SYSTEM_PROMPT,
        },
      })

      let resultText: string | null = null
      for await (const msg of q) {
        if (msg.type === 'result' && msg.subtype === 'success') {
          resultText = msg.result
        }
      }

      return normalizeTitle(resultText)
    } catch {
      return null
    }
  }
}

function normalizeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null
  let title = raw.trim()
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1).trim()
  }
  if (!title) return null
  if (title.length > MAX_TITLE_LEN) {
    title = title.slice(0, MAX_TITLE_LEN).trimEnd()
  }
  return title || null
}
