import type { Skill } from '@jetty/shared/wire'

import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { homedir } from 'node:os'

type SkillSources = { projectPath?: string; userHome?: string }

type Frontmatter = {
  description: string
  userInvocable: boolean
}

export function parseSkillFrontmatter(text: string): Frontmatter {
  const meta: Frontmatter = { description: '', userInvocable: true }
  if (!text.startsWith('---')) return meta
  const end = text.indexOf('\n---', 3)
  if (end === -1) return meta

  for (const raw of text.slice(4, end).split('\n')) {
    const line = raw.trimEnd()
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = unquote(line.slice(colon + 1).trim())
    if (key === 'description') meta.description = value
    if (key === 'user-invocable') meta.userInvocable = value !== 'false'
  }
  return meta
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const q = value[0]
    if ((q === '"' || q === "'") && value.at(-1) === q) return value.slice(1, -1)
  }
  return value
}

function addSkill(into: Map<string, Skill>, name: string, filePath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const meta = yield* fs.readFileString(filePath).pipe(
      Effect.map(parseSkillFrontmatter),
      Effect.catch(() => Effect.succeed(null))
    )
    if (!meta || !meta.userInvocable) return
    into.set(name, { name, description: meta.description })
  })
}

function loadSkillDirs(into: Map<string, Skill>, skillsDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(skillsDir).pipe(Effect.catch(() => Effect.succeed([])))
    for (const name of entries) {
      if (name.toLowerCase() === 'synced') continue
      const dir = path.join(skillsDir, name)
      const directory = yield* fs.stat(dir).pipe(
        Effect.map((stat) => stat.type === 'Directory'),
        Effect.catch(() => Effect.succeed(false))
      )
      if (!directory) continue
      yield* addSkill(into, name, path.join(dir, 'SKILL.md'))
    }
  })
}

function loadCommandFiles(into: Map<string, Skill>, commandsDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs
      .readDirectory(commandsDir)
      .pipe(Effect.catch(() => Effect.succeed([])))
    for (const file of entries) {
      if (!file.endsWith('.md') || file === '.md') continue
      const name = path.basename(file, '.md')
      yield* addSkill(into, name, path.join(commandsDir, file))
    }
  })
}

function loadClaudeRoot(into: Map<string, Skill>, claudeRoot: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path
    yield* loadCommandFiles(into, path.join(claudeRoot, 'commands'))
    yield* loadSkillDirs(into, path.join(claudeRoot, 'skills'))
  })
}

export function listSkills(opts: SkillSources = {}) {
  return Effect.gen(function* () {
    const path = yield* Path.Path
    const into = new Map<string, Skill>()
    // Personal skills load last so they win a name clash.
    if (opts.projectPath) yield* loadClaudeRoot(into, path.join(opts.projectPath, '.claude'))
    yield* loadClaudeRoot(into, path.join(opts.userHome ?? homedir(), '.claude'))
    return [...into.values()].sort((a, b) => a.name.localeCompare(b.name))
  })
}

export const Skills = Context.Service<{
  listSkills: (opts?: SkillSources) => Effect.Effect<Skill[]>
}>('jetty/Skills')

export const SkillsLive = Layer.effect(
  Skills,
  Effect.gen(function* () {
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
    return {
      listSkills: (opts?: SkillSources) => listSkills(opts).pipe(Effect.provideContext(services)),
    }
  })
)
