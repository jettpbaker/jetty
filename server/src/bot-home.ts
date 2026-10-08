import type { Bot, Project } from '@jetty/shared/wire'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { BOT_PROMPT } from './bot-prompt'
import { jettyInstructions } from './jetty-instructions'

async function git(cwd: string, args: string[]) {
  const proc = Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) throw new Error(await new Response(proc.stderr).text())
  return (await new Response(proc.stdout).text()).trim()
}

export async function createBotHome(home: string) {
  const root = join(home, '..')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'preferences.md'), '', { flag: 'a' })
  for (const folder of ['pages', 'log', 'files'])
    await mkdir(join(home, folder), { recursive: true })
  for (const file of ['brief.md', 'index.md']) await writeFile(join(home, file), '', { flag: 'a' })
  await writeFile(join(home, 'CLAUDE.md'), '@brief.md\n@index.md\n@../preferences.md\n')
  await git(home, ['init', '-q', '-b', 'main'])
  await commitBotHome(home, 'Initial bot home')
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
  home: string
) {
  const user = await botUserName()
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
    questionTool: 'AskUserQuestion',
  }
  let prompt = BOT_PROMPT.split('\n')
    .filter((line) => !line.includes('{if auto}') || bot.permissionMode === 'auto')
    .filter((line) => !line.includes('{if full access}') || bot.permissionMode === 'full_access')
    .join('\n')
    .replaceAll('{if auto} ', '')
    .replaceAll('{if full access} ', '')
  for (const [key, value] of Object.entries(fill)) prompt = prompt.replaceAll(`{${key}}`, value)
  const base = jettyInstructions(behaviours).replace(
    'When you hand finished work back to the user, or need their decision, call mark_ready_for_review so the thread stands out in their sidebar. ',
    ''
  )
  return `${base}\n\n${prompt}`
}
