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

function commandHeads(command: string) {
  const heads: string[] = []
  let start = 0
  let quote = ''
  let depth = 0
  let piped = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    if (char === '\\' && quote !== "'") {
      index++
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth || ![';', '&', '|', '\n'].includes(char)) continue
    if (char === '&' && /[<>]/.test(command[index - 1] ?? '')) continue
    const paired = (char === '&' || char === '|') && command[index + 1] === char
    if (!piped) heads.push(command.slice(start, index).trim())
    piped = char === '|' && !paired
    if (paired) index++
    start = index + 1
  }
  if (!piped) heads.push(command.slice(start).trim())
  return heads.filter(Boolean)
}

function commandPrefix(command: string) {
  const tokens = command.replace(/^(?:[A-Za-z_][\w]*=\S+\s+)+/, '').split(/\s+/)
  const executable = tokens[0]!
  const words = [executable]
  const limit = executable === 'gh' ? 3 : executable === 'git' ? 2 : 1
  for (const token of tokens.slice(1)) {
    if (words.length === limit || !/^[a-z][\w-]*$/i.test(token)) break
    words.push(token)
  }
  return words.join(' ')
}

function commandPrefixes(
  command: string,
  suggestions: readonly PermissionUpdate[],
  matchedAskRule?: string
) {
  const heads = commandHeads(command)
  const substantive = heads.filter(
    (head) => !/^(?:echo|printf|true|cd|pwd|:)(?:\s|$)/.test(commandPrefix(head))
  )
  const candidates = substantive.length ? substantive : heads.slice(0, 1)
  function matchingPrefix(content: string) {
    const prefix = content.replace(/:?\s*\*$/, '').trim()
    const head = candidates.find((head) => head === prefix || head.startsWith(`${prefix} `))
    if (!head) return undefined
    return content.endsWith('*') && /^[a-z][\w-]*(?: [a-z][\w-]*){0,2}$/i.test(prefix)
      ? prefix
      : commandPrefix(head)
  }
  const matched = matchedAskRule && matchingPrefix(matchedAskRule)
  if (matched) return [matched]
  const suggested = suggestions.flatMap((suggestion) =>
    suggestion.type === 'addRules'
      ? suggestion.rules.flatMap((rule) => {
          const prefix =
            rule.toolName === 'Bash' && rule.ruleContent
              ? matchingPrefix(rule.ruleContent)
              : undefined
          return prefix ? [prefix] : []
        })
      : []
  )
  return suggested.length
    ? [...new Set(suggested)]
    : [commandPrefix(candidates.at(-1) ?? command.trim())]
}

// A bot's approval in plain words: the card's title, and the Allow always rule saved from it,
// worded as the bot's settings list it ("Close the two v16 issues with `gh issue close`").
export function botApproval(
  toolName: string,
  input: Record<string, unknown>,
  suggestions: readonly PermissionUpdate[],
  places: readonly BotPlace[],
  matchedAskRule?: string
) {
  const description = text(input.description)
  const command = text(input.command)
  if (toolName === 'Bash' && command) {
    const covered = commandPrefixes(command, suggestions, matchedAskRule)
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
