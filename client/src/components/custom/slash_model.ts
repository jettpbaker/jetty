import type { Bot } from '@jetty/shared/wire'

// / opens skills; @ opens bots, where the composer offers them.
export type Trigger = '/' | '@'

export type SlashQuery = {
  start: number
  end: number
  query: string
  trigger: Trigger
}

export type MentionBot = Pick<Bot, 'id' | 'name' | 'shape' | 'color'>

export type SlashToken = { start: number; end: number; name: string; bot?: MentionBot }

export function activeSlash(text: string, caret: number): SlashQuery | undefined {
  const before = text.slice(0, caret)
  let end = caret
  while (end < text.length && !/\s/.test(text.charAt(end))) end++
  const match = /(^|\s)([/@])([\p{L}\p{N}_-]*)$/u.exec(before)
  if (!match) return undefined
  const [, lead = '', trigger = '/', query = ''] = match
  const start = match.index + lead.length
  return { start, end, query, trigger: trigger as Trigger }
}

const wordCharacter = /[\p{L}\p{N}_-]/u

// A bot's name after @, the longest that fits, ending where a word would. Names can have spaces,
// so this reads names, not words.
export function mentionTokens(
  text: string,
  bots: readonly MentionBot[]
): (SlashToken & { bot: MentionBot })[] {
  const longest = [...bots].sort((a, b) => b.name.length - a.name.length)
  return [...text.matchAll(/(^|\s)@/g)].flatMap((match) => {
    const start = match.index + (match[1]?.length ?? 0)
    const bot = longest.find(
      ({ name }) =>
        text.startsWith(name, start + 1) &&
        !wordCharacter.test(text.charAt(start + 1 + name.length))
    )
    return bot ? [{ start, end: start + 1 + bot.name.length, name: bot.name, bot }] : []
  })
}

// What a mention sends: a link the bot can act on, by id, since names repeat and change.
export function linkMentions(text: string, bots: readonly MentionBot[]) {
  let linked = ''
  let at = 0
  for (const { start, end, name, bot } of mentionTokens(text, bots)) {
    const label = name.replace(/[[\]\\]/g, '\\$&')
    linked += `${text.slice(at, start)}[@${label}](jetty://bots/${bot.id})`
    at = end
  }
  return linked + text.slice(at)
}

export function slashTokens(text: string): SlashToken[] {
  return [...text.matchAll(/(^|\s)\/([\w-]+)(?=\s|$)/g)].map((match) => {
    const [, lead = '', name = ''] = match
    const start = match.index + lead.length
    return { start, end: start + name.length + 1, name }
  })
}

// The textarea shows a chip's slash as a no-break space, which composer_slash.css widens to hold
// the icon, and the space after it as an en space, room for its padding. One character for one,
// so the shown text and the message share every index.
export const chipLead = '\u00a0'
const chipTail = '\u2002'

export function chipped(text: string, chips: readonly SlashToken[]) {
  let shown = ''
  let at = 0
  for (const chip of chips) {
    shown += `${text.slice(at, chip.start)}${chipLead}${text.slice(chip.start + 1, chip.end)}`
    at = chip.end
    if (text[at] === ' ') {
      shown += chipTail
      at++
    }
  }
  return shown + text.slice(at)
}

// The textarea's edit, made to the message. The edit ends at the caret, which settles where a
// character typed beside an identical one went. Chips the edit brings back (an undo, a drop of
// the textarea's own text) get their / or @ back; `leads` maps each chip name to its trigger.
export function applyEdit(
  text: string,
  shown: string,
  next: string,
  caret: number,
  leads: ReadonlyMap<string, Trigger>
) {
  let tail = 0
  while (
    tail < next.length - caret &&
    tail < shown.length &&
    next[next.length - 1 - tail] === shown[shown.length - 1 - tail]
  )
    tail++
  let head = 0
  while (head < next.length - tail && head < shown.length - tail && next[head] === shown[head])
    head++
  const edit = restoreLeads(next.slice(head, next.length - tail), leads)
  return text.slice(0, head) + edit + text.slice(shown.length - tail)
}

function restoreLeads(edit: string, leads: ReadonlyMap<string, Trigger>) {
  if (!leads.size || !edit.includes(chipLead)) return edit
  const names = [...leads.keys()]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const chip = new RegExp(`(^|\\s)\u00a0(${names.join('|')})(\u2002|(?![\\p{L}\\p{N}_-]))`, 'gu')
  return edit.replace(
    chip,
    (_, space: string, name: string, tail: string) =>
      `${space}${leads.get(name)}${name}${tail ? ' ' : ''}`
  )
}

function isSubsequence(query: string, text: string) {
  let index = 0
  for (const char of text) if (char === query[index]) index++
  return index === query.length
}

// Higher is better; undefined means no match. Descriptions only count from three characters, so short queries stay on names.
export function matchScore(name: string, description: string, query: string): number | undefined {
  const q = query.toLowerCase()
  if (!q) return 0
  const n = name.toLowerCase()
  if (n.startsWith(q)) return 400 - n.length
  if (n.split(/[-\s.]/).some((part) => part.startsWith(q))) return 300 - n.length
  if (n.includes(q)) return 200 - n.length
  if (isSubsequence(q, n)) return 100 - n.length
  if (
    q.length >= 3 &&
    description
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(q))
  )
    return 50
  return undefined
}
