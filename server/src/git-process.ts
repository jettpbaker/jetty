import { Effect, Stream } from 'effect'
import { ChildProcess } from 'effect/process'

// Hands stdout to `onText` as it arrives, so a caller can keep only what it needs of it.
export function gitStream(
  cwd: string,
  args: string[],
  onText: (text: string) => void,
  input?: string
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const process = yield* ChildProcess.make('git', args, {
        cwd,
        stdin: input === undefined ? 'ignore' : Stream.make(new TextEncoder().encode(input)),
        stdout: 'pipe',
        stderr: 'ignore',
        forceKillAfter: '1 second',
      })
      yield* process.stdout.pipe(
        Stream.decodeText(),
        Stream.runForEach((text) => Effect.sync(() => onText(text)))
      )
      return Number(yield* process.exitCode)
    })
  ).pipe(
    Effect.timeout('30 seconds'),
    Effect.catch(() => Effect.succeed(-1))
  )
}

export function git(cwd: string, args: string[], input?: string) {
  return Effect.suspend(() => {
    const chunks: string[] = []
    return gitStream(cwd, args, (text) => chunks.push(text), input).pipe(
      Effect.map((code) => ({ code, out: code === -1 ? '' : chunks.join('') }))
    )
  })
}
