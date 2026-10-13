import type { Bot, BotTask, Project } from '@jetty/shared/wire'

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { botTiming } from './bot-lifecycle'
import { BOT_PROMPT_FILES } from './bot-prompt'
import { botJettyInstructions, jettyInstructions } from './jetty-instructions'

async function git(cwd: string, args: string[]) {
  const proc = Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) throw new Error(await new Response(proc.stderr).text())
  return (await new Response(proc.stdout).text()).trim()
}

const sharedCommits = new Map<string, Promise<void>>()

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function writeChanged(path: string, content: string) {
  if ((await readExisting(path)) !== content) await writeFile(path, content)
}

async function readExisting(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (!missing(error)) throw error
    return undefined
  }
}

async function createInstructions(home: string) {
  try {
    await writeFile(join(home, 'instructions.md'), '# Your instructions\n\n', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function writeBotTasks(home: string, tasks: readonly BotTask[]) {
  const open = tasks.filter((task) => task.status === 'todo' || task.status === 'in_progress')
  const entries = open.map(
    (task) => `- ${task.id} [${task.status}]: ${task.title}${task.note ? `\n  ${task.note}` : ''}`
  )
  await writeChanged(
    join(home, 'open-tasks.md'),
    `# Open tasks\n\nManaged by Jetty. Use add_task and update_task to change this list.\n\n${entries.join('\n') || '(none)'}\n`
  )
}

export async function createBotHome(home: string) {
  await commitSharedPreferences(home)
  for (const folder of ['pages', 'log', 'files'])
    await mkdir(join(home, folder), { recursive: true })
  for (const file of ['brief.md', 'index.md']) await writeFile(join(home, file), '', { flag: 'a' })
  await createInstructions(home)
  await writeBotTasks(home, [])
  await writeFile(
    join(home, 'CLAUDE.md'),
    '@instructions.md\n@brief.md\n@index.md\n@open-tasks.md\n'
  )
  await git(home, ['init', '-q', '-b', 'main'])
  await commitBotHome(home, 'Initial bot home')
}

async function ensureSharedPreferences(home: string) {
  const root = join(home, '..')
  const shared = join(root, 'shared')
  const preferences = join(shared, 'preferences.md')
  await mkdir(shared, { recursive: true })
  try {
    await stat(preferences)
  } catch (error) {
    if (!missing(error)) throw error
    try {
      await rename(join(root, 'preferences.md'), preferences)
    } catch (error) {
      if (!missing(error)) throw error
      await writeFile(preferences, '', { flag: 'a' })
    }
  }
  try {
    await stat(join(shared, '.git'))
  } catch (error) {
    if (!missing(error)) throw error
    await git(shared, ['init', '-q', '-b', 'main'])
  }
  return shared
}

export async function commitSharedPreferences(home: string) {
  const root = join(home, '..')
  const previous = sharedCommits.get(root) ?? Promise.resolve()
  const next = previous.then(() => commitSharedPreferencesNow(home))
  sharedCommits.set(
    root,
    next.then(
      () => {},
      () => {}
    )
  )
  return next
}

async function commitSharedPreferencesNow(home: string) {
  const shared = await ensureSharedPreferences(home)
  await git(shared, ['add', 'preferences.md'])
  const staged = await git(shared, ['diff', '--cached', '--name-only'])
  if (!staged) return false
  await git(shared, [
    '-c',
    'user.name=Jetty',
    '-c',
    'user.email=jetty@localhost',
    'commit',
    '-q',
    '-m',
    'Update shared preferences',
  ])
  return true
}

export async function commitBotHome(home: string, message = 'Update bot home') {
  await git(home, ['add', '-A'])
  const staged = await git(home, ['diff', '--cached', '--name-only'])
  if (!staged) return false
  await git(home, [
    '-c',
    'user.name=Jetty',
    '-c',
    'user.email=jetty@localhost',
    'commit',
    '-q',
    '-m',
    message,
  ])
  return true
}

function displayPath(path: string) {
  return path.startsWith(homedir() + '/') ? '~' + path.slice(homedir().length) : path
}

export async function botUserName() {
  try {
    const config = JSON.parse(
      await readFile(join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json'), 'utf8')
    ) as { oauthAccount?: { displayName?: string } }
    const name = config.oauthAccount?.displayName?.trim()
    if (name) return name
  } catch {}
  try {
    const proc = Bun.spawn(['git', 'config', 'user.name'], { stdout: 'pipe' })
    const name = (await new Response(proc.stdout).text()).trim().split(/\s+/)[0]
    if (name) return name
  } catch {}
  return 'the user'
}

export async function botInstructions(
  bot: Bot,
  projects: readonly Project[],
  behaviours: Parameters<typeof jettyInstructions>[0],
  home: string,
  migrate?: (text: string) => Promise<void>
) {
  await writeBotTasks(home, bot.tasks)
  await commitSharedPreferences(home)
  const preferences = await readFile(join(home, '..', 'shared', 'preferences.md'), 'utf8')
  const user = await botUserName()
  if ((await readExisting(join(home, 'instructions.md'))) === undefined) {
    const pages = await readdir(join(home, 'pages'), { withFileTypes: true })
    if (migrate && pages.some((page) => page.isFile() && page.name.endsWith('.md')))
      await migrate(
        `Jetty update: you now have standing instructions in instructions.md (see "Your instructions" in your prompt). Look through your index and pages for how ${user} wants things done and for lessons you wrote for yourself, add each with add_instruction (reason: "moved from pages/<file>"), and take them out of the pages. Facts stay in pages. Don't message ${user} about this.`
      )
    await createInstructions(home)
  }
  const named = projects.map((project) => `${project.title} (${displayPath(project.path)})`)
  const selected = projects.find((project) => project.id === bot.projectId)
  const others = projects
    .filter((project) => project.id !== bot.projectId)
    .map((project) => `${project.title} (${displayPath(project.path)})`)
  const project = selected
    ? `Yours is ${selected.title} (${displayPath(selected.path)}): when ${user} asks for work without saying where, it's for this project. It's your default, not a limit; other projects: ${others.join(', ') || 'none'}.`
    : projects.length
      ? `You work across all of ${user}'s projects: ${named.join(', ')}. Work out which one a request is about from what they say, and ask only if it's genuinely unclear. Name the project when you start a worker, and keep that choice with the task, not in your pages.`
      : `${user} hasn't added a project yet. You can help with anything, but code work needs one: offer to add a folder with add_project.`
  const fill: Record<string, string> = {
    name: bot.name,
    user,
    home,
    bots: join(home, '..'),
    project,
    projects: named.join(', '),
    others: others.join(', ') || 'none',
    questionTool: bot.provider === 'codex' ? 'request_user_input' : 'AskUserQuestion',
    checkIn: `${Math.round(botTiming.checkInMs[bot.provider].ms / 60_000)} minutes`,
    questioning:
      bot.provider === 'copilot'
        ? `When you need ${user}, ask one thing in your reply (or with message_user in a wake turn), give your recommendation and why it matters, then end your turn. Copilot has no question tool in Jetty.`
        : `When you need ${user}, ask one thing, with your recommendation and why it matters, so they can answer in a word. When the answer blocks your work and comes down to a few clear options, ask with ${bot.provider === 'codex' ? 'request_user_input' : 'AskUserQuestion'}, so ${user} can tap an answer and sees you're waiting on them; ask anything casual in plain text, or with message_user in a turn they didn't start.`,
    investigations:
      bot.provider === 'claude'
        ? "To look into something, do it yourself or use your model's built-in subagents (Agent/Task), so the answer comes back within your turn."
        : 'To look into something, do it yourself or hand it to a Jetty worker thread. Codex and Copilot have native subagents, but bot delegation goes through Jetty workers so their lifecycle and reports survive restarts.',
  }
  const base = botJettyInstructions(behaviours, bot.provider)
  const files = [{ name: 'jetty.md', content: `${base}\n` }]
  for (const name of BOT_PROMPT_FILES) {
    const source = await readFile(new URL(`./bot-prompt/${name}`, import.meta.url), 'utf8')
    let content = source
      .split('\n')
      .filter((line) => !line.includes('{if auto}') || bot.permissionMode === 'auto')
      .filter((line) => !line.includes('{if full access}') || bot.permissionMode === 'full_access')
      .filter((line) => !line.includes('{if archive}') || behaviours.archiveCompletedThreads)
      .join('\n')
      .replaceAll('{if auto} ', '')
      .replaceAll('{if full access} ', '')
      .replaceAll('{if archive} ', '')
    for (const [key, value] of Object.entries(fill)) content = content.replaceAll(`{${key}}`, value)
    files.push({ name, content })
  }
  files.push({
    name: 'preferences.md',
    content: `## Shared preferences\n\n${preferences || '(none yet)'}\n`,
  })
  const folder = join(home, '.jetty', 'instructions')
  await mkdir(folder, { recursive: true })
  for (const file of files) await writeChanged(join(folder, file.name), file.content)
  const names = new Set(files.map((file) => file.name))
  for (const name of await readdir(folder))
    if (!names.has(name)) await rm(join(folder, name), { recursive: true })
  await writeChanged(
    join(home, 'CLAUDE.md'),
    [
      ...files.map((file) => `@.jetty/instructions/${file.name}`),
      '@instructions.md',
      '@brief.md',
      '@index.md',
      '@open-tasks.md',
      '',
    ].join('\n')
  )
  const ignorePath = join(home, '.gitignore')
  const ignore = (await readExisting(ignorePath)) ?? ''
  if (!ignore.split('\n').includes('.jetty/'))
    await writeFile(ignorePath, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}.jetty/\n`)
  return createHash('sha256')
    .update(JSON.stringify(files.map((file) => file.content)))
    .digest('hex')
}

export const MANAGED_BOT_FILES = ['instructions.md', 'CLAUDE.md', 'open-tasks.md'] as const

const managedEdits = new Map<string, Promise<void>>()

// Parallel tool calls edit managed files at once; each edit restores, writes and commits, so they
// run one at a time per home.
export function editManagedBotFiles<T>(home: string, edit: () => Promise<T>) {
  const next = (managedEdits.get(home) ?? Promise.resolve()).then(edit)
  managedEdits.set(
    home,
    next.then(
      () => {},
      () => {}
    )
  )
  return next
}

export async function commitManagedBotFiles(home: string, files: readonly string[]) {
  const changed = await git(home, ['diff', 'HEAD', '--name-only', '--', ...files])
  if (!changed) return
  await git(home, ['add', '--', ...files])
  await git(home, [
    '-c',
    'user.name=Jetty',
    '-c',
    'user.email=jetty@localhost',
    'commit',
    '-q',
    '--only',
    '-m',
    'Update managed bot files',
    '--',
    ...files,
  ])
}

export async function restoreManagedBotFiles(
  home: string,
  files: readonly string[] = MANAGED_BOT_FILES
) {
  const changed = await git(home, ['diff', 'HEAD', '--name-only', '--', ...files])
  if (!changed) return false
  await git(home, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...files])
  return true
}

export async function prepareBotHome(...args: Parameters<typeof botInstructions>) {
  const [bot, projects, , home] = args
  const instructionsHash = await botInstructions(...args)
  const staticPrompt = (
    await Promise.all(
      ['jetty.md', ...BOT_PROMPT_FILES, 'preferences.md'].map((name) =>
        readFile(join(home, '.jetty', 'instructions', name), 'utf8')
      )
    )
  ).join('\n')
  const memory = (
    await Promise.all(
      ['instructions.md', 'brief.md', 'index.md', 'open-tasks.md'].map(
        async (name) => `## ${name}\n\n${await readFile(join(home, name), 'utf8')}`
      )
    )
  ).join('\n\n')
  const snapshot = `${staticPrompt}\n\n${memory}`
  await commitManagedBotFiles(home, MANAGED_BOT_FILES)
  return {
    staticPrompt,
    memory,
    snapshot,
    hash: createHash('sha256').update(snapshot).digest('hex'),
    instructionsHash,
    allowedPaths: [
      join(home, '..'),
      ...(bot.projectId
        ? projects.filter((project) => project.id === bot.projectId)
        : projects
      ).map((project) => project.path),
    ],
  }
}
