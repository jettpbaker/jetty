import { Effect, Stream } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

export function git(cwd: string, args: string[]) {
  return Effect.scoped(
    Effect.gen(function* () {
      const process = yield* ChildProcess.make('git', args, {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
        forceKillAfter: '1 second',
      })
      const out = yield* process.stdout.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => '',
          (text, chunk) => text + chunk
        )
      )
      const code = yield* process.exitCode
      return { code: Number(code), out }
    })
  ).pipe(
    Effect.timeout('30 seconds'),
    Effect.catch(() => Effect.succeed({ code: -1, out: '' }))
  )
}
