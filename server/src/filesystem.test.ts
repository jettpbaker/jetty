import { BunServices } from '@effect/platform-bun'
import { describe, expect, test } from 'bun:test'
import { Deferred, Effect, Fiber, FileSystem, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { computeThreadDiff, readProjectFile, writeProjectFile } from './diff'
import { browse, expandHome, normalizePath } from './fs-browse'
import { fuzzyMatch, searchFiles } from './fs-search'
import { git } from './git-process'
import { listSkills } from './skills'

function commitAll(root: string) {
  return Effect.gen(function* () {
    yield* git(root, ['add', '.'])
    const committer = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']
    yield* git(root, [...committer, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init'])
  })
}

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

  test('file search reuses its filename index briefly, then picks up new files', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          yield* git(root, ['init'])
          yield* fs.writeFileString(root + '/alpha.txt', 'a')
          const real = yield* ChildProcessSpawner.ChildProcessSpawner
          let enumerations = 0
          const spawner = ChildProcessSpawner.make((command) => {
            enumerations++
            return real.spawn(command)
          })
          const search = (query: string) =>
            searchFiles(root, query).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
            )
          expect(yield* search('a')).toEqual(['alpha.txt'])
          expect(yield* search('alp')).toEqual(['alpha.txt'])
          expect(enumerations).toBe(1)
          yield* fs.writeFileString(root + '/beta.txt', 'b')
          yield* Effect.sleep('2100 millis')
          expect(yield* search('bet')).toEqual(['beta.txt'])
          expect(enumerations).toBe(2)
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

  test('search walks a folder that is not a repository, and diff stays empty', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const root = yield* fs.makeTempDirectoryScoped()
          yield* fs.writeFileString(path.join(root, 'CLAUDE.md'), '# hi')
          yield* fs.makeDirectory(path.join(root, 'nested', 'cache'), { recursive: true })
          yield* fs.writeFileString(path.join(root, 'nested', 'note.txt'), 'n')
          yield* fs.writeFileString(path.join(root, 'nested', 'cache', 'kept.txt'), 'yes')
          yield* fs.makeDirectory(path.join(root, 'cache'))
          yield* fs.writeFileString(path.join(root, 'cache', 'blob.txt'), 'no')
          yield* fs.makeDirectory(path.join(root, 'projects', 'deep'), { recursive: true })
          yield* fs.writeFileString(path.join(root, 'projects', 'deep', 'hidden.txt'), 'no')
          yield* fs.makeDirectory(path.join(root, 'node_modules'))
          yield* fs.writeFileString(path.join(root, 'node_modules', 'pkg.js'), 'no')
          yield* fs.makeDirectory(path.join(root, 'file-history'))
          yield* fs.writeFileString(path.join(root, 'file-history', 'old.txt'), 'no')
          yield* fs.makeDirectory(path.join(root, 'shell-snapshots'))
          yield* fs.writeFileString(path.join(root, 'shell-snapshots', 'snap.txt'), 'no')
          yield* fs.makeDirectory(path.join(root, 'vendor', '.git'), { recursive: true })
          yield* fs.writeFileString(path.join(root, 'vendor', '.git', 'config'), 'no')
          yield* fs.writeFileString(path.join(root, 'vendor', 'keep.txt'), 'yes')
          yield* fs.makeDirectory(path.join(root, 'elsewhere'))
          yield* fs.writeFileString(path.join(root, 'elsewhere', 'secret.txt'), 'no')
          yield* fs.symlink(path.join(root, 'elsewhere'), path.join(root, 'linked'))
          yield* fs.symlink(path.join(root, 'CLAUDE.md'), path.join(root, 'claude-link.md'))
          expect(yield* searchFiles(root, 'note')).toEqual(['nested/note.txt'])
          expect(yield* searchFiles(root, 'keep')).toEqual(['vendor/keep.txt'])
          expect(yield* searchFiles(root, 'kept')).toContain('nested/cache/kept.txt')
          expect(yield* searchFiles(root, 'blob')).toEqual([])
          expect(yield* searchFiles(root, 'claude')).toEqual(['CLAUDE.md', 'claude-link.md'])
          expect(yield* searchFiles(root, 'hidden')).toEqual([])
          expect(yield* searchFiles(root, 'secret')).toEqual(['elsewhere/secret.txt'])
          expect(yield* searchFiles(root, 'linked')).toEqual([])
          expect(yield* searchFiles(root, 'pkg')).toEqual([])
          expect(yield* searchFiles(root, 'snap')).toEqual([])
          expect(yield* searchFiles(root, 'config')).toEqual([])
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

  test('a file that is not UTF-8 opens as text marked read-only, and saving it is refused', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const root = yield* fs.makeTempDirectoryScoped()
          yield* fs.writeFileString(path.join(root, 'ok.txt'), 'café\n')
          expect(yield* readProjectFile(root, 'ok.txt')).toEqual({ contents: 'café\n' })
          // 0xE9 is é in Latin-1 and not a UTF-8 sequence.
          yield* fs.writeFile(
            path.join(root, 'latin1.txt'),
            new Uint8Array([0x63, 0x61, 0x66, 0xe9])
          )
          const read = yield* readProjectFile(root, 'latin1.txt')
          expect(read).toMatchObject({ utf8: false })
          if (!('contents' in read) || typeof read.contents !== 'string')
            throw new Error('expected decoded text')
          expect(Buffer.from(read.contents).equals(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe(
            false
          )
          const refused = yield* writeProjectFile(
            root,
            'latin1.txt',
            read.contents,
            read.contents
          ).pipe(Effect.catch((error) => Effect.succeed(error)))
          expect(refused).toMatchObject({ code: 'invalid_params' })
          expect(Buffer.from(yield* fs.readFile(path.join(root, 'latin1.txt')))).toEqual(
            Buffer.from([0x63, 0x61, 0x66, 0xe9])
          )
        })
      )
    )
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

  test('oversized deleted files with Git-quoted names are reported', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          expect((yield* git(root, ['init', '-q'])).code).toBe(0)
          const names = [
            'tab\tfile',
            'line\nfile',
            'quote"file',
            'back\\file',
            'café\tfile',
            '\x01file',
          ]
          for (const name of names)
            yield* fs.writeFileString(root + '/' + name, 'x'.repeat(140_000))
          yield* commitAll(root)
          for (const name of names) yield* fs.remove(root + '/' + name)
          const result = yield* computeThreadDiff(root)
          expect(result.diff).toBe('')
          expect(result.truncatedPaths?.toSorted()).toEqual(names.toSorted())
        })
      )
    )
  })

  test('diff keeps ordinary patches and omits lockfiles and oversized sections', async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const root = yield* fs.makeTempDirectoryScoped()
          expect((yield* git(root, ['init', '-q'])).code).toBe(0)
          for (const name of ['source.ts', 'bun.lock', 'huge.txt'])
            yield* fs.writeFileString(root + '/' + name, 'old\n')
          yield* commitAll(root)
          yield* fs.writeFileString(root + '/source.ts', 'code\n')
          yield* fs.writeFileString(root + '/bun.lock', 'lock\n')
          yield* fs.writeFileString(root + '/huge.txt', 'x'.repeat(128 * 1024))
          const { diff, truncatedPaths } = yield* computeThreadDiff(root)
          expect(diff.match(/^diff --git .*$/gm)).toEqual(['diff --git a/source.ts b/source.ts'])
          expect(diff).toContain('+code')
          expect(truncatedPaths).toEqual(['bun.lock', 'huge.txt'])
        })
      )
    )
  })
})
