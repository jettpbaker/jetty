import { expect, test } from 'bun:test'
import { AtomRegistry } from 'effect/reactivity'
import 'sonner'

const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
const listenerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener')
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { querySelector: () => null, addEventListener: () => {} },
})
Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: () => {} })
const { beginFileSave, endFileSave, readFileDraft, settleFileDraft, writeFileDraft } =
  await import('../src/state/file_drafts')
for (const [key, descriptor] of [
  ['document', documentDescriptor],
  ['addEventListener', listenerDescriptor],
] as const) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor)
  else Reflect.deleteProperty(globalThis, key)
}

test('undo to the original base survives a save, including closing and reopening the editor', () => {
  const registry = AtomRegistry.make()
  try {
    writeFileDraft(registry, 'undo-save', 'file', { base: 'A', text: 'B' })
    beginFileSave('undo-save', 'file')
    writeFileDraft(registry, 'undo-save', 'file', { base: 'A', text: 'A' })
    expect(readFileDraft('undo-save', 'file')).toEqual({ base: 'A', text: 'A' })
    settleFileDraft(registry, 'undo-save', 'file', 'B')
    endFileSave(registry, 'undo-save', 'file')
    expect(readFileDraft('undo-save', 'file')).toEqual({ base: 'B', text: 'A' })
    writeFileDraft(registry, 'undo-save', 'file', { base: 'B', text: 'B' })
    expect(readFileDraft('undo-save', 'file')).toBeUndefined()
  } finally {
    registry.dispose()
  }
})

test('an undone draft survives a conflict or lost save reply until disk is verified', () => {
  const registry = AtomRegistry.make()
  try {
    writeFileDraft(registry, 'failed-save', 'file', { base: 'A', text: 'B' })
    beginFileSave('failed-save', 'file')
    writeFileDraft(registry, 'failed-save', 'file', { base: 'A', text: 'A' })
    endFileSave(registry, 'failed-save', 'file')
    expect(readFileDraft('failed-save', 'file')).toEqual({ base: 'A', text: 'A', unverified: true })
    writeFileDraft(registry, 'failed-save', 'file', readFileDraft('failed-save', 'file'))
    expect(readFileDraft('failed-save', 'file')?.text).toBe('A')
    settleFileDraft(registry, 'failed-save', 'file', 'C')
    expect(readFileDraft('failed-save', 'file')).toEqual({ base: 'C', text: 'A' })
  } finally {
    registry.dispose()
  }
})
