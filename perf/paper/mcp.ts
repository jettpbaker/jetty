import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const fileId = '01M2PDASEXB2BWZDF31NSHVW4G'

type Content = { type: string; text?: string; data?: string; mimeType?: string }
export type ToolResult = { content: Content[]; isError?: boolean }

export async function connectPaper() {
  const config = await readFile(join(homedir(), '.codex/config.toml'), 'utf8')
  const section = config.match(/\[mcp_servers\.paper\]([^]*?)(?=\n\[|$)/)?.[1]
  const endpoint = process.env.PAPER_MCP_URL ?? section?.match(/^url\s*=\s*"([^"]+)"/m)?.[1]
  if (!endpoint) throw new Error('Configure the paper MCP server or set PAPER_MCP_URL')
  const url = new URL(endpoint)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('The capture only connects to the local Paper desktop MCP')
  let session: string | null = null
  let sequence = 0

  async function request(method: string, params?: unknown) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session && { 'Mcp-Session-Id': session }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
      signal: AbortSignal.timeout(120_000),
    })
    session = response.headers.get('mcp-session-id') ?? session
    const body = await response.text()
    if (!response.ok) throw new Error(`Paper MCP ${response.status}: ${body}`)
    const messages = response.headers.get('content-type')?.includes('text/event-stream')
      ? body
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => JSON.parse(line.slice(6)))
      : [JSON.parse(body)]
    const message = messages.find((entry) => entry.id === sequence)
    if (!message || message.error) throw new Error(JSON.stringify(message?.error ?? messages))
    return message.result
  }

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'jetty-paper-capture', version: '1' },
  })

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = (await request('tools/call', { name, arguments: args })) as ToolResult
    if (
      result.isError ||
      result.content.some((item) => item.type === 'text' && /"error"\s*:/.test(item.text ?? ''))
    )
      throw new Error(`${name}: ${JSON.stringify(result.content)}`)
    return result
  }

  await call('get_guide', { topic: 'paper-mcp-instructions' })
  await call('get_font_family_info', { familyNames: ['Geist', 'Geist Mono'] })
  async function syncTokens(tokens: { name: string; value: string }[]) {
    const current = payload<{ tokens: { name: string }[] }>(
      await call('get_tokens', { fileId })
    ).tokens
    const names = new Set(current.map((token) => token.name))
    const fresh = tokens.filter((token) => !names.has(token.name))
    const known = tokens.filter((token) => names.has(token.name))
    function type(name: string) {
      if (name.startsWith('--font-weight-')) return 'fontWeight'
      const namespace = name.split('-')[2]
      return (
        {
          color: 'color',
          font: 'fontFamily',
          text: 'fontSize',
          leading: 'lineHeight',
          tracking: 'letterSpacing',
          spacing: 'spacing',
          radius: 'radius',
          breakpoint: 'breakpoint',
          container: 'container',
          opacity: 'opacity',
        } as const
      )[namespace as 'color']
    }
    if (fresh.length)
      await call('create_tokens', {
        fileId,
        tokens: fresh.map((token) => ({ ...token, type: type(token.name) })),
      })
    if (known.length) await call('set_tokens', { fileId, tokens: known })
  }
  return { call, syncTokens }
}

export function payload<T>(result: ToolResult): T {
  for (const item of [...result.content].reverse()) {
    if (item.type !== 'text' || !item.text) continue
    try {
      return JSON.parse(item.text) as T
    } catch {}
  }
  throw new Error(`Paper returned no JSON: ${JSON.stringify(result.content)}`)
}
