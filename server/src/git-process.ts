import { Effect, Stream } from 'effect'
import { ChildProcess } from 'effect/process'
import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'

// Hands stdout to `onText` as it arrives, so a caller can keep only what it needs of it.
export function gitStream(cwd: string, args: string[], onText: (text: string) => void) {
  return Effect.scoped(
    Effect.gen(function* () {
      const process = yield* ChildProcess.make('git', args, {
        cwd,
        stdin: 'ignore',
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

export function git(cwd: string, args: string[]) {
  return Effect.suspend(() => {
    const chunks: string[] = []
    return gitStream(cwd, args, (text) => chunks.push(text)).pipe(
      Effect.map((code) => ({ code, out: code === -1 ? '' : chunks.join('') }))
    )
  })
}

export function gitWritableRoots(cwd: string) {
  return Effect.gen(function* () {
    const common = yield* git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (common.code !== 0) return []
    const dir = yield* git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir'])
    if (dir.code !== 0) return []
    const commonDir = yield* Effect.tryPromise(() => realpath(common.out.replace(/\r?\n$/, '')))
    const gitDir = yield* Effect.tryPromise(() => realpath(dir.out.replace(/\r?\n$/, '')))
    // Codex protects a worktree's resolved gitdir unless it has an explicit grant.
    return gitDir.startsWith(commonDir + sep) ? [commonDir, gitDir] : [commonDir]
  })
}
