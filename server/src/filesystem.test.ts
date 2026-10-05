import { BunServices } from '@effect/platform-bun'
import { describe, expect, test } from 'bun:test'
import { Deferred, Effect, Fiber, FileSystem, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { computeThreadDiff, truncateDiff, writeProjectFile } from './diff'
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
          for (let index = 0; index < 505; index++)
            yield* fs.makeDirectory(path.join(root, `entry-${index}`))
          expect((yield* browse(root + '/')).entries).toHaveLength(500)
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

  test('search ranks tracked and untracked files and excludes ignored ones', async () => {
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
          expect(yield* searchFiles(root, 'btn')).toEqual([
            'button.md',
            'src/button.ts',
            'untracked-button.ts',
          ])
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
              if (command._tag === 'StandardCommand')
                expect(command.args).toEqual([
                  'ls-files',
                  '-z',
                  '--cached',
                  '--others',
                  '--exclude-standard',
                ])
              const handle = yield* real.spawn(
                ChildProcess.make(process.execPath, [
                  '-e',
                  'process.stdout.write("a file;name.ts\\0")',
                ])
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

  test('concurrent saves through case aliases cannot both create a file', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          yield* fs.writeFileString(root + '/probe', '')
          if (!(yield* fs.exists(root + '/PROBE'))) return
          for (let round = 0; round < 8; round++) {
            const results = yield* Effect.promise(() =>
              Promise.all([
                run(
                  writeProjectFile(root, `new${round}.txt`, 'a'.repeat(900_000), null).pipe(
                    Effect.catch((error) => Effect.succeed({ error: error.code }))
                  )
                ),
                run(
                  writeProjectFile(root, `NEW${round}.txt`, 'b'.repeat(900_000), null).pipe(
                    Effect.catch((error) => Effect.succeed({ error: error.code }))
                  )
                ),
              ])
            )
            expect(results.filter((result) => 'saved' in result)).toHaveLength(1)
            const contents = yield* fs.readFileString(root + `/new${round}.txt`)
            const loser = results.find((result) => !('saved' in result))
            expect(loser).toEqual(
              loser && 'error' in loser ? { error: 'conflict' } : { conflict: { contents } }
            )
          }
        })
      )
    )
  })

  test('a symlink retargeted while its save waits never writes the stale destination', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          yield* fs.writeFileString(root + '/a', 'old')
          yield* fs.writeFileString(root + '/b', 'old')
          yield* fs.symlink(root + '/a', root + '/current')
          let retargeted = false
          const changed = {
            ...fs,
            realPath: (path: string) =>
              fs.realPath(path).pipe(
                Effect.tap(() =>
                  Effect.gen(function* () {
                    if (!path.endsWith('/current') || retargeted) return
                    retargeted = true
                    yield* fs.remove(path)
                    yield* fs.symlink(root + '/b', path)
                  })
                )
              ),
          }
          expect(
            yield* writeProjectFile(root, 'current', 'new', 'old').pipe(
              Effect.provideService(FileSystem.FileSystem, changed),
              Effect.catch((error) => Effect.succeed({ error: error.code }))
            )
          ).toEqual({ error: 'conflict' })
          expect(yield* fs.readFileString(root + '/a')).toBe('old')
          expect(yield* fs.readFileString(root + '/b')).toBe('old')
        })
      )
    )
  })

  test('atomic saving supports filenames at the filesystem component limit', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          const name = 'x'.repeat(255)
          yield* fs.writeFileString(root + '/' + name, 'old')
          expect(yield* writeProjectFile(root, name, 'new', 'old')).toEqual({ saved: true })
          expect(yield* fs.readFileString(root + '/' + name)).toBe('new')
          expect(yield* fs.readDirectory(root)).toEqual([name])
        })
      )
    )
  })

  test('saving anyway restores deleted parent folders without following outside symlinks', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          yield* fs.makeDirectory(root + '/sub/nested', { recursive: true })
          yield* fs.writeFileString(root + '/sub/nested/file.txt', 'old')
          yield* fs.remove(root + '/sub', { recursive: true })
          expect(yield* writeProjectFile(root, 'sub/nested/file.txt', 'new', 'old')).toEqual({
            conflict: { contents: null },
          })
          expect(yield* fs.exists(root + '/sub')).toBe(false)
          expect(yield* writeProjectFile(root, 'sub/nested/file.txt', 'new', null)).toEqual({
            saved: true,
          })
          expect(yield* fs.readFileString(root + '/sub/nested/file.txt')).toBe('new')
          const outside = yield* fs.makeTempDirectoryScoped()
          yield* fs.symlink(outside, root + '/escape')
          const rejected = yield* writeProjectFile(
            root,
            'escape/missing/file.txt',
            'new',
            null
          ).pipe(Effect.catch((error) => Effect.succeed({ error: error.code })))
          expect(rejected).toEqual({ error: 'invalid_params' })
          expect(yield* fs.exists(outside + '/missing')).toBe(false)
        })
      )
    )
  })

  test('oversized quoted Git paths retain their truncation notices', () => {
    const paths = [
      ['tab\tfile', '"tab\\tfile"'],
      ['line\nfile', '"line\\nfile"'],
      ['quote"file', '"quote\\"file"'],
      ['back\\file', '"back\\\\file"'],
      ['café\tfile', '"caf\\303\\251\\tfile"'],
    ] as const
    for (const [path, quoted] of paths) {
      const a = '"a/' + quoted.slice(1)
      const b = '"b/' + quoted.slice(1)
      const header = `diff --git ${a} ${b}\n`
      for (const markers of [`+++ ${b}\n`, `--- ${a}\n+++ /dev/null\n`, '']) {
        expect(truncateDiff(header + markers + '+' + 'x'.repeat(128 * 1024))).toEqual({
          diff: '',
          truncatedPaths: [path],
        })
      }
    }
  })

  test('streamed oversized files with Git-quoted names are reported', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          expect((yield* git(root, ['init', '-q'])).code).toBe(0)
          const names = ['tab\tfile', 'line\nfile', 'quote"file', 'back\\file']
          for (const name of names)
            yield* fs.writeFileString(root + '/' + name, 'x'.repeat(140_000))
          const result = yield* computeThreadDiff(root)
          expect(result.diff).toBe('')
          expect(result.truncatedPaths?.sort()).toEqual(names.sort())
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
