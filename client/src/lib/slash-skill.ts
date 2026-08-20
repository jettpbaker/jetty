import type { Skill } from '@jetty/shared/wire'

export type SlashQuery = {
  /** Index of the triggering `/`. */
  start: number
  /** Text after `/` up to the caret. */
  query: string
}

/** `/` at the start of a token (input start or after whitespace). */
export function slashQueryAt(text: string, caret: number): SlashQuery | null {
  if (caret < 1) return null
  let start = caret
  while (start > 0 && !/\s/.test(text[start - 1]!)) start--
  if (text[start] !== '/') return null
  const query = text.slice(start + 1, caret)
  if (/[\s]/.test(query)) return null
  return { start, query }
}

export function filterSkills(skills: Skill[], query: string): Skill[] {
  if (query.length === 0) return skills
  const q = query.toLowerCase()
  const matches: Skill[] = []
  for (const skill of skills) {
    if (skill.name.toLowerCase().startsWith(q)) matches.push(skill)
  }
  return matches
}

export function insertSkill(text: string, slash: SlashQuery, caret: number, name: string): string {
  const after = text.slice(caret)
  const spacer = after.startsWith(' ') || after.startsWith('\n') ? '' : ' '
  return `${text.slice(0, slash.start)}/${name}${spacer}${after}`
}
