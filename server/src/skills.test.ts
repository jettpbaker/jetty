import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listSkills, parseSkillFrontmatter } from './skills'

function writeSkill(root: string, name: string, body: string) {
  const dir = join(root, '.claude', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
}

function writeCommand(root: string, name: string, body: string) {
  const dir = join(root, '.claude', 'commands')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.md`), body)
}

describe('parseSkillFrontmatter', () => {
  test('reads description and defaults user-invocable to true', () => {
    const meta = parseSkillFrontmatter(
      '---\nname: demo\ndescription: Does a thing\n---\n\n# Demo\n'
    )
    expect(meta.description).toBe('Does a thing')
    expect(meta.userInvocable).toBe(true)
  })

  test('honors user-invocable: false', () => {
    const meta = parseSkillFrontmatter('---\nuser-invocable: false\n---\n')
    expect(meta.userInvocable).toBe(false)
  })

  test('strips quotes around values', () => {
    const meta = parseSkillFrontmatter('---\ndescription: "Quoted desc"\n---\n')
    expect(meta.description).toBe('Quoted desc')
  })

  test('missing frontmatter is invocable with empty description', () => {
    const meta = parseSkillFrontmatter('# just markdown\n')
    expect(meta).toEqual({ description: '', userInvocable: true })
  })
})

describe('listSkills', () => {
  test('merges project + personal, personal wins, hides non-invocable', () => {
    const project = mkdtempSync(join(tmpdir(), 'jetty-skills-proj-'))
    const user = mkdtempSync(join(tmpdir(), 'jetty-skills-user-'))
    try {
      writeSkill(project, 'review', '---\ndescription: Project review\n---\n')
      writeSkill(
        project,
        'hidden',
        '---\ndescription: Background only\nuser-invocable: false\n---\n'
      )
      writeCommand(project, 'ship', '---\ndescription: Old command\n---\n')
      writeSkill(user, 'review', '---\ndescription: Personal review\n---\n')
      writeSkill(user, 'summarize', '---\ndescription: Sum it up\n---\n')

      const skills = listSkills({ projectPath: project, userHome: user })
      expect(skills.map((s) => s.name)).toEqual(['review', 'ship', 'summarize'])
      expect(skills.find((s) => s.name === 'review')?.description).toBe('Personal review')
      expect(skills.find((s) => s.name === 'ship')?.description).toBe('Old command')
    } finally {
      rmSync(project, { recursive: true, force: true })
      rmSync(user, { recursive: true, force: true })
    }
  })

  test('skill wins over a same-named command', () => {
    const project = mkdtempSync(join(tmpdir(), 'jetty-skills-clash-'))
    try {
      writeCommand(project, 'deploy', '---\ndescription: Command deploy\n---\n')
      writeSkill(project, 'deploy', '---\ndescription: Skill deploy\n---\n')
      const skills = listSkills({ projectPath: project, userHome: join(project, 'no-user') })
      expect(skills).toEqual([{ name: 'deploy', description: 'Skill deploy' }])
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })

  test('personal-only when projectPath is omitted', () => {
    const user = mkdtempSync(join(tmpdir(), 'jetty-skills-useronly-'))
    try {
      writeSkill(user, 'notes', '---\ndescription: Take notes\n---\n')
      expect(listSkills({ userHome: user })).toEqual([{ name: 'notes', description: 'Take notes' }])
    } finally {
      rmSync(user, { recursive: true, force: true })
    }
  })
})
