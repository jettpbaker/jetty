import { useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/reactivity'

export type CachedToolOutput = { output: string; seq: number }

const noOutputs: readonly (string | undefined)[] = []

export const toolOutputsAtom = Atom.family((_threadId: string) =>
  Atom.make<ReadonlyMap<string, CachedToolOutput>>(new Map()).pipe(Atom.setIdleTTL('10 minutes'))
)

const selectedOutputsAtom = Atom.family((key: string) => {
  const [threadId, ...ids] = key.split('\0')
  return Atom.readable<readonly (string | undefined)[]>((get) =>
    ids.length ? ids.map((id) => get(toolOutputsAtom(threadId!)).get(id)?.output) : noOutputs
  ).pipe(
    Atom.withEquality<readonly (string | undefined)[]>(
      (a, b) => a.length === b.length && a.every((value, index) => value === b[index])
    )
  )
})

export function useToolOutputs(threadId: string | undefined, ids: readonly string[]) {
  return useAtomValue(selectedOutputsAtom(threadId ? [threadId, ...ids].join('\0') : ''))
}
