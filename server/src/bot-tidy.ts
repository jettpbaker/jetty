import type { EffortLevel } from '@jetty/shared/events'

import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { claudeJobModel, newId, type Bot } from '@jetty/shared/wire'
import { Cause, Effect, Exit, Queue } from 'effect'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { Store } from './store'

import { botUserName, commitBotHome } from './bot-home'
import { botTiming, type BotLifecycle } from './bot-lifecycle'
import { claudeBin } from './claude-bin'

async function botHomeGit(home: string, args: string[]) {
  const proc = Bun.spawn(['git', '-C', home, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(stderr.trim())
  return stdout.trimEnd()
}

function within(root: string, path: string) {
  const child = relative(root, path)
  return !isAbsolute(child) && child !== '..' && !child.startsWith('../')
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(await canonical(parent), relative(parent, path))
  }
}

async function tidyQuery(
  bot: Bot,
  home: string,
  model: { id: string; effort?: EffortLevel },
  signal: AbortSignal
) {
  const bots = await realpath(join(home, '..'))
  const root = await realpath(home)
  const pages = join(root, 'pages')
  const index = join(root, 'index.md')
  let prompt = await readFile(new URL('./bot-prompt/tidy.md', import.meta.url), 'utf8')
  for (const [key, value] of Object.entries({ name: bot.name, home, bots: join(home, '..') }))
    prompt = prompt.replaceAll(`{${key}}`, value)
  const canUseTool: NonNullable<Options['canUseTool']> = async (tool, input) => {
    const writing = tool === 'Edit' || tool === 'Write'
    if (!writing && tool !== 'Read' && tool !== 'Glob' && tool !== 'Grep')
      return { behavior: 'deny', message: 'Only wiki file tools are allowed.' }
    const path = input.file_path ?? input.path ?? (writing || tool === 'Read' ? undefined : home)
    if (typeof path !== 'string') return { behavior: 'deny', message: 'A file path is required.' }
    if (
      tool === 'Glob' &&
      typeof input.pattern === 'string' &&
      (isAbsolute(input.pattern) || input.pattern.split('/').includes('..'))
    )
      return { behavior: 'deny', message: 'Use a relative glob within the approved search path.' }
    const requested =
      isAbsolute(path) && within(resolve(home), path)
        ? resolve(root, relative(resolve(home), path))
        : resolve(root, path)
    const target = await canonical(requested)
    const writable =
      (requested === index || within(pages, requested)) &&
      (target === index || within(pages, target))
    if (writing ? writable : within(bots, target)) return { behavior: 'allow', updatedInput: input }
    return {
      behavior: 'deny',
      message: writing
        ? 'Only index.md and pages/ may be edited; brief, log/ and files/ are the bot’s.'
        : 'Read only under the bots folder.',
    }
  }
  const abortController = new AbortController()
  const q = query({
    prompt,
    options: {
      model: model.id,
      ...(model.effort ? { effort: model.effort } : {}),
      cwd: home,
      pathToClaudeCodeExecutable: claudeBin,
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      canUseTool,
      abortController,
    },
  })
  function abort() {
    abortController.abort()
    q.close()
  }
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 20 * 60_000)
  try {
    signal.throwIfAborted()
    let text = ''
    let succeeded = false
    for await (const message of q) {
      if (message.type === 'assistant') {
        const blocks = message.message.content.flatMap((block) =>
          block.type === 'text' ? [block.text] : []
        )
        if (blocks.length) text = blocks.join('\n')
      }
      if (message.type === 'result') {
        if (message.subtype !== 'success' || message.is_error)
          throw new Error(
            message.subtype === 'success' ? message.result : message.errors.join('; ')
          )
        succeeded = true
      }
    }
    signal.throwIfAborted()
    if (!succeeded || abortController.signal.aborted)
      throw new Error('Tidy pass ended without a successful result')
    return text
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    q.close()
  }
}

export function tidyBotHome(bot: Bot, home: string, store: Store, record: BotLifecycle) {
  let completed = false
  return Effect.gen(function* () {
    yield* Effect.tryPromise(() => commitBotHome(home)).pipe(Effect.uninterruptible)
    const head = yield* Effect.tryPromise(() => botHomeGit(home, ['rev-parse', 'HEAD']))
    const pages = yield* Effect.tryPromise(() =>
      readdir(join(home, 'pages'), { withFileTypes: true })
    )
    const hasPages = pages.some((page) => page.isFile() && page.name.endsWith('.md'))
    if (head === record.tidiedHead || !hasPages) {
      yield* store.updateBotLifecycle(bot.id, { tidiedAt: Date.now() })
      yield* Effect.logInfo(
        `tidy pass for ${bot.id} skipped: ${hasPages ? 'home unchanged' : 'no pages'}`
      )
      completed = true
      return
    }
    yield* Effect.logInfo(`tidy pass for ${bot.id} started`)
    const choice = claudeJobModel(
      'tidy',
      yield* store.getJobModel('tidy').pipe(Effect.orElseSucceed(() => undefined))
    )
    const model = { id: choice.model.id, ...(choice.effort ? { effort: choice.effort } : {}) }
    const changelog = yield* Effect.tryPromise({
      try: (signal) => tidyQuery(bot, home, model, signal),
      catch: (error) => error,
    })
    yield* Effect.gen(function* () {
      const changed = yield* Effect.tryPromise(() =>
        botHomeGit(home, ['status', '--porcelain', '--', 'pages', 'index.md'])
      )
      if (changed) {
        yield* Effect.tryPromise(() => botHomeGit(home, ['add', '--', 'pages', 'index.md']))
        yield* Effect.tryPromise(() =>
          botHomeGit(home, [
            '-c',
            'user.name=Jetty',
            '-c',
            'user.email=jetty@localhost',
            'commit',
            '-q',
            '-m',
            'Tidy pass',
            '-m',
            changelog,
          ])
        )
      }
      const sha = yield* Effect.tryPromise(() => botHomeGit(home, ['rev-parse', 'HEAD']))
      if (changed) {
        const patch = yield* Effect.tryPromise(() =>
          botHomeGit(home, ['show', '--format=', '--no-ext-diff', sha])
        )
        const user = yield* Effect.tryPromise(botUserName)
        const truncated = patch.length > 30_000
        const text = `Jetty's daily tidy pass went over your wiki and changed it. Its changelog and diff are below. Check the changes against what you know and undo anything wrong; if they're right, end your turn without messaging ${user}.\n\n${changelog}\n\n\`\`\`diff\n${patch.slice(0, 30_000)}\n\`\`\`${truncated ? `\n\n(The diff is cut off here. See all of it with \`git -C ${home} show ${sha}\`.)` : ''}`
        yield* store.enqueue(bot.id, {
          id: newId(),
          createdAt: Date.now(),
          hop: 0,
          text,
          kind: 'tidy',
          from: { threadId: bot.id, title: 'Jetty' },
        })
        yield* Queue.offer(store.queueChanges, undefined)
        yield* Effect.logInfo(`tidy pass for ${bot.id} committed ${sha}`)
      } else yield* Effect.logInfo(`tidy pass for ${bot.id} made no changes`)
      yield* store.updateBotLifecycle(bot.id, {
        tidiedAt: Date.now(),
        tidiedHead: sha,
        tidyRetryAt: Date.now() + botTiming.retryMs,
      })
      completed = true
    }).pipe(Effect.uninterruptible)
  }).pipe(
    Effect.onExit((exit) =>
      Effect.gen(function* () {
        if (completed) return
        yield* Effect.tryPromise(() =>
          botHomeGit(home, ['checkout', 'HEAD', '--', 'pages', 'index.md'])
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning(`tidy pass for ${bot.id} restore failed: ${error}`)
          )
        )
        yield* Effect.tryPromise(() => botHomeGit(home, ['clean', '-fdq', '--', 'pages'])).pipe(
          Effect.catch((error) =>
            Effect.logWarning(`tidy pass for ${bot.id} cleanup failed: ${error}`)
          )
        )
        if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) {
          yield* Effect.logInfo(`tidy pass for ${bot.id} interrupted`)
        } else {
          yield* store.updateBotLifecycle(bot.id, { tidyRetryAt: Date.now() + botTiming.retryMs })
          yield* Effect.logInfo(
            `tidy pass for ${bot.id} failed: ${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'no result'}`
          )
        }
      })
    )
  )
}
