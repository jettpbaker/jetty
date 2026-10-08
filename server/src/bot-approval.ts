import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { BotAllowRule } from '@jetty/shared/wire'

import { homedir } from 'node:os'
import { dirname, isAbsolute, relative } from 'node:path'

// A folder a bot's rules name in words: its home, or a project by title.
export type BotPlace = { path: string; name: string }

const fileVerbs: Record<string, string> = {
  Write: 'Write files in',
  Edit: 'Edit files in',
  MultiEdit: 'Edit files in',
  NotebookEdit: 'Edit files in',
  Read: 'Read files in',
  Glob: 'Search files in',
  Grep: 'Search files in',
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// "Re-run" becomes "re-run"; "GitHub" and "PR" keep their capitals.
function lowerFirst(phrase: string) {
  const word = phrase.split(/\s/, 1)[0]!
  return /[A-Z0-9]/.test(word.slice(1)) ? phrase : phrase[0]!.toLowerCase() + phrase.slice(1)
}

function placeOf(folder: string, places: readonly BotPlace[]) {
  for (const place of places) {
    const inner = relative(place.path, folder)
    if (!inner.startsWith('..') && !isAbsolute(inner)) return place.name
  }
  const home = homedir()
  return folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder
}

// The part of a command Allow always covers: Claude's own suggested prefixes, else its leading
// plain words (`gh issue close 212` covers `gh issue close`).
function commandPrefixes(command: string, suggestions: readonly PermissionUpdate[]) {
  const suggested = suggestions.flatMap((suggestion) =>
    suggestion.type === 'addRules'
      ? suggestion.rules.flatMap((rule) =>
          rule.toolName === 'Bash' && rule.ruleContent
            ? [rule.ruleContent.replace(/:?\s*\*$/, '').trim()]
            : []
        )
      : []
  )
  if (suggested.length) return [...new Set(suggested)]
  const tokens = command.trim().split(/\s+/)
  const words: string[] = []
  for (const token of tokens) {
    if (words.length === 3 || !/^[a-z][\w-]*$/i.test(token)) break
    words.push(token)
  }
  return [words.join(' ') || tokens[0]!]
}

// A bot's approval in plain words: the card's title, and the Allow always rule saved from it,
// worded as the bot's settings list it ("Close the two v16 issues with `gh issue close`").
export function botApproval(
  toolName: string,
  input: Record<string, unknown>,
  suggestions: readonly PermissionUpdate[],
  places: readonly BotPlace[]
) {
  const description = text(input.description)
  const command = text(input.command)
  if (toolName === 'Bash' && command) {
    const covered = commandPrefixes(command, suggestions)
      .map((prefix) => `\`${prefix}\``)
      .join(' and ')
    return description
      ? { title: description, rule: `${description} with ${covered}` }
      : { title: `Run ${covered.replaceAll('`', '')}`, rule: `Run ${covered}` }
  }
  const title = description ?? actionOf(toolName, input, places)
  return { title, rule: title }
}

function actionOf(toolName: string, input: Record<string, unknown>, places: readonly BotPlace[]) {
  const verb = fileVerbs[toolName]
  if (verb) {
    const file = text(input.file_path) ?? text(input.notebook_path)
    const folder = file ? dirname(file) : text(input.path)
    return `${verb} ${folder ? placeOf(folder, places) : (places[0]?.name ?? 'its home')}`
  }
  if (toolName === 'WebFetch') {
    const url = URL.parse(text(input.url) ?? '')
    return url ? `Fetch pages from ${url.host}` : 'Fetch web pages'
  }
  if (toolName === 'WebSearch') return 'Search the web'
  const [, server, tool] = toolName.split('__')
  return toolName.startsWith('mcp__') && server && tool
    ? `Use ${tool} from ${server}`
    : `Use ${toolName}`
}

// Claude's auto mode classifier reads each rule with the bot as its subject. "$defaults" keeps
// its built-in rules; without it the list replaces them.
export function botAutoMode(name: string, rules: readonly BotAllowRule[]) {
  return {
    autoMode: {
      allow: [
        '$defaults',
        ...rules.map((rule) =>
          rule.text.startsWith(`${name} `) ? rule.text : `${name} may ${lowerFirst(rule.text)}`
        ),
      ],
    },
  }
}
