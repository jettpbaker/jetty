import type { Skill } from '@jetty/shared/wire'

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const SKIP_DIRS = new Set(['synced'])

type Frontmatter = {
  description: string
  userInvocable: boolean
}

export function parseSkillFrontmatter(text: string): Frontmatter {
  const defaults: Frontmatter = { description: '', userInvocable: true }
  if (!text.startsWith('---')) return defaults
  const end = text.indexOf('\n---', 3)
  if (end === -1) return defaults

  let description = ''
  let userInvocable = true
  for (const raw of text.slice(4, end).split('\n')) {
    const line = raw.trimEnd()
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = unquote(line.slice(colon + 1).trim())
    if (key === 'description') description = value
    if (key === 'user-invocable') userInvocable = value !== 'false'
  }
  return { description, userInvocable }
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const q = value[0]
    if ((q === '"' || q === "'") && value.at(-1) === q) return value.slice(1, -1)
  }
  return value
}

function readSkillFile(path: string): Frontmatter | null {
  try {
    return parseSkillFrontmatter(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function addSkill(into: Map<string, Skill>, name: string, filePath: string) {
  if (!name || name.includes('/') || name.includes('\\')) return
  const meta = readSkillFile(filePath)
  if (!meta || !meta.userInvocable) return
  into.set(name, { name, description: meta.description })
}

function loadSkillDirs(into: Map<string, Skill>, skillsDir: string) {
  if (!existsSync(skillsDir)) return
  let entries: string[]
  try {
    entries = readdirSync(skillsDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name.toLowerCase())) continue
    const dir = join(skillsDir, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    addSkill(into, name, join(dir, 'SKILL.md'))
  }
}

function loadCommandFiles(into: Map<string, Skill>, commandsDir: string) {
  if (!existsSync(commandsDir)) return
  let entries: string[]
  try {
    entries = readdirSync(commandsDir)
  } catch {
    return
  }
  for (const file of entries) {
    if (!file.endsWith('.md')) continue
    const name = basename(file, '.md')
    addSkill(into, name, join(commandsDir, file))
  }
}

function loadClaudeRoot(into: Map<string, Skill>, claudeRoot: string) {
  // commands first so a same-named skill wins
  loadCommandFiles(into, join(claudeRoot, 'commands'))
  loadSkillDirs(into, join(claudeRoot, 'skills'))
}

/** Personal + optional project skills. Personal wins on a name clash. */
export function listSkills(opts: { projectPath?: string; userHome?: string } = {}): Skill[] {
  const into = new Map<string, Skill>()
  if (opts.projectPath) loadClaudeRoot(into, join(opts.projectPath, '.claude'))
  loadClaudeRoot(into, join(opts.userHome ?? homedir(), '.claude'))
  return [...into.values()].sort((a, b) => a.name.localeCompare(b.name))
}
