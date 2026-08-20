import { describe, expect, test } from 'bun:test'

import { filterSkills, insertSkill, slashQueryAt } from './slash-skill'

describe('slashQueryAt', () => {
  test('opens on a leading slash', () => {
    expect(slashQueryAt('/', 1)).toEqual({ start: 0, query: '' })
    expect(slashQueryAt('/rev', 4)).toEqual({ start: 0, query: 'rev' })
  })

  test('opens after whitespace', () => {
    expect(slashQueryAt('please /rev', 11)).toEqual({ start: 7, query: 'rev' })
  })

  test('ignores slashes inside a token', () => {
    expect(slashQueryAt('http://x', 7)).toBeNull()
    expect(slashQueryAt('foo/bar', 7)).toBeNull()
  })

  test('ignores a caret before the slash', () => {
    expect(slashQueryAt('/rev', 0)).toBeNull()
  })
})

describe('filterSkills', () => {
  const skills = [
    { name: 'review', description: 'Look at the diff' },
    { name: 'improve-animations', description: 'Motion audit' },
    { name: 'deploy', description: 'Ship it' },
  ]

  test('empty query returns all', () => {
    expect(filterSkills(skills, '').map((s) => s.name)).toEqual([
      'review',
      'improve-animations',
      'deploy',
    ])
  })

  test('prefix matches rank first', () => {
    expect(filterSkills(skills, 're').map((s) => s.name)).toEqual(['review'])
    expect(filterSkills(skills, 'imp').map((s) => s.name)).toEqual(['improve-animations'])
  })

  test('falls back to description', () => {
    expect(filterSkills(skills, 'motion').map((s) => s.name)).toEqual(['improve-animations'])
  })
})

describe('insertSkill', () => {
  test('replaces the slash token and leaves a trailing space', () => {
    const slash = slashQueryAt('/rev more', 4)!
    expect(insertSkill('/rev more', slash, 4, 'review')).toBe('/review more')
  })

  test('inserts at a mid-text slash', () => {
    const text = 'please /'
    const slash = slashQueryAt(text, 8)!
    expect(insertSkill(text, slash, 8, 'deploy')).toBe('please /deploy ')
  })
})
