import { BunServices } from '@effect/platform-bun'
import { describe, expect, test } from 'bun:test'
import { Deferred, Effect, Fiber, FileSystem, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import { computeThreadDiff, truncateDiff } from './diff'
import { browse, expandHome, normalizePath } from './fs-browse'
import { fuzzyMatch, searchFiles } from './fs-search'
import { git } from './git-process'
import { listSkills } from './skills'

function run<A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) {
  return Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)))
}

describe('Effect filesystem services', () => {
  test('browse preserves prefixes, dotfiles, symlinks, ordering and the result cap', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const root = yield* fs.makeTempDirectoryScoped()
          for (const name of ['Alpha', 'alpine', '.hidden', 'Beta']) {
            yield* fs.makeDirectory(path.join(root, name))
          }
          yield* fs.writeFileString(path.join(root, 'afile'), 'not a directory')
          yield* fs.symlink(path.join(root, 'Alpha'), path.join(root, 'alink'))
          expect((yield* browse(root + '/a')).entries.map((entry) => entry.name)).toEqual([
            'alink',
            'Alpha',
            'alpine',
          ])
          expect((yield* browse(root + '/.h')).entries.map((entry) => entry.name)).toEqual([
            '.hidden',
          ])
          expect((yield* browse(root + '/')).entries.map((entry) => entry.name)).toEqual([
            'alink',
            'Alpha',
            'alpine',
            'Beta',
          ])
          expect((yield* browse(root + '/missing/')).entries).toEqual([])
          for (let index = 0; index < 55; index++)
            yield* fs.makeDirectory(path.join(root, `entry-${index}`))
          expect((yield* browse(root + '/')).entries).toHaveLength(50)
          expect(normalizePath(root + '/Alpha/../Beta')).toBe(root + '/Beta')
          expect(expandHome('relative')).toBe('relative')
        })
      )
    )
  })

  test('unreadable filesystem directories yield empty browse and skills results', async () => {
    const fs = FileSystem.makeNoop({})
    const program = Effect.gen(function* () {
      expect((yield* browse('/missing/')).entries).toEqual([])
      expect(yield* listSkills({ userHome: '/missing' })).toEqual([])
    }).pipe(Effect.provideService(FileSystem.FileSystem, fs))
    await run(program)
  })

  test('search ranks tracked files and excludes ignored and untracked files', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          expect((yield* git(root, ['init'])).code).toBe(0)
          yield* fs.makeDirectory(root + '/src')
          yield* fs.writeFileString(root + '/src/button.ts', 'button')
          yield* fs.writeFileString(root + '/button.md', 'button')
          yield* fs.writeFileString(root + '/untracked-button.ts', 'not tracked')
          yield* fs.writeFileString(root + '/ignored-button.ts', 'ignored')
          yield* fs.writeFileString(root + '/.gitignore', 'ignored-*\n')
          expect((yield* git(root, ['add', 'src/button.ts', 'button.md', '.gitignore'])).code).toBe(
            0
          )
          expect(yield* searchFiles(root, 'btn')).toEqual(['button.md', 'src/button.ts'])
          expect(yield* searchFiles(root, 'btn', 1)).toEqual(['button.md'])
          expect(yield* searchFiles(root, '')).toEqual([])
          expect(fuzzyMatch('button.md', 'missing')).toBeNull()
        })
      )
    )
  })

  test('diff includes staged and untracked changes in an unborn repository but excludes ignored files', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          yield* git(root, ['init'])
          yield* fs.writeFileString(root + '/tracked.txt', 'tracked\n')
          yield* fs.writeFileString(root + '/untracked.txt', 'new\n')
          yield* fs.writeFileString(root + '/ignored.txt', 'hidden\n')
          yield* fs.writeFileString(root + '/.gitignore', 'ignored.txt\n')
          yield* git(root, ['add', 'tracked.txt', '.gitignore'])
          const { diff } = yield* computeThreadDiff(root)
          expect(diff).toContain('diff --git a/tracked.txt b/tracked.txt')
          expect(diff).toContain('diff --git a/untracked.txt b/untracked.txt')
          expect(diff).not.toContain('diff --git a/ignored.txt')
          expect(diff.indexOf('diff --git a/tracked.txt')).toBeLessThan(
            diff.indexOf('diff --git a/untracked.txt')
          )
        })
      )
    )
  })

  test('search and diff return empty outside a repository or when spawning fails', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          expect(yield* searchFiles(root, 'a')).toEqual([])
          expect(yield* computeThreadDiff(root)).toEqual({ diff: '' })
          expect(yield* searchFiles(root + '/missing', 'a')).toEqual([])
        })
      )
    )
  })

  test('git subprocesses terminate when their calling fiber is interrupted', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const real = yield* ChildProcessSpawner.ChildProcessSpawner
          const started = yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>()
          const spawner = ChildProcessSpawner.make(() =>
            Effect.gen(function* () {
              const handle = yield* real.spawn(
                ChildProcess.make(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
                  stdout: 'pipe',
                  stderr: 'ignore',
                  forceKillAfter: '100 millis',
                })
              )
              yield* Deferred.succeed(started, handle)
              return handle
            })
          )
          const fiber = yield* searchFiles('/', 'a').pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.forkScoped
          )
          const handle = yield* Deferred.await(started)
          expect(yield* handle.isRunning).toBe(true)
          yield* Fiber.interrupt(fiber)
          expect(yield* handle.isRunning).toBe(false)
        })
      )
    )
  })

  test('git preserves argument boundaries and closes streams before returning', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const real = yield* ChildProcessSpawner.ChildProcessSpawner
          let closed = false
          const spawner = ChildProcessSpawner.make((command) =>
            Effect.gen(function* () {
              expect(command._tag).toBe('StandardCommand')
              if (command._tag === 'StandardCommand') expect(command.args).toEqual(['ls-files'])
              const handle = yield* real.spawn(
                ChildProcess.make(process.execPath, ['-e', 'console.log("a file;name.ts")'])
              )
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  closed = true
                })
              )
              return { ...handle, stdout: Stream.concat(handle.stdout, Stream.empty) }
            })
          )
          expect(
            yield* searchFiles('/', 'afn').pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
            )
          ).toEqual(['a file;name.ts'])
          expect(closed).toBe(true)
        })
      )
    )
  })

  test('pure diff truncation retains ordinary patches and omits lockfiles and oversized sections', () => {
    const normal = 'diff --git a/source.ts b/source.ts\n+++ b/source.ts\n@@ -0,0 +1 @@\n+code\n'
    const lock = 'diff --git a/bun.lock b/bun.lock\n+++ b/bun.lock\n+lock\n'
    const huge = 'diff --git a/huge.txt b/huge.txt\n+++ b/huge.txt\n+' + 'x'.repeat(128 * 1024)
    expect(truncateDiff(normal + lock + huge)).toEqual({
      diff: normal,
      truncatedPaths: ['bun.lock', 'huge.txt'],
    })
  })
})
