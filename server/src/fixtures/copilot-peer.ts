import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

if (process.env.COPILOT_PEER_CWD) process.chdir(process.env.COPILOT_PEER_CWD)
writeFileSync('peer.pid', String(process.pid))
let active: { id: number; params: { prompt: { text?: string }[] } } | undefined
let model = 'gpt-5-mini'
let effort = 'medium'
let allow = 'off'
let text = ''
function send(message: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...(message as object) }) + '\n')
}
function result(id: unknown, value: unknown = {}) {
  send({ id, result: value })
}
function update(value: unknown, sessionId = 'copilot-session') {
  send({ method: 'session/update', params: { sessionId, update: value } })
}
function config() {
  return [
    {
      id: 'model',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: [
        { value: 'gpt-5-mini', name: 'GPT-5 mini' },
        { value: 'slow-model', name: 'Slow' },
        { value: 'disabled-model', name: 'Disabled', _meta: { copilotEnablement: 'disabled' } },
      ],
    },
    {
      id: 'reasoning_effort',
      category: 'thought_level',
      type: 'select',
      currentValue: effort,
      options: (model === 'slow-model'
        ? ['low', 'medium', 'high', 'xhigh']
        : ['low', 'medium', 'high']
      ).map((value) => ({ value, name: value })),
    },
    {
      id: 'allow_all',
      category: 'permissions',
      type: 'select',
      currentValue: allow,
      options: [{ value: 'on' }, { value: 'off' }],
    },
    {
      id: 'mode',
      category: 'mode',
      type: 'select',
      currentValue: 'agent',
      options: [{ value: 'agent' }, { value: 'plan' }],
    },
  ]
}
function complete() {
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello 🛶' } })
  result(active!.id, { stopReason: 'end_turn' })
}
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line)
  appendFileSync('peer.jsonl', JSON.stringify(m) + '\n')
  if (m.method === 'initialize')
    result(m.id, {
      protocolVersion: 1,
      authMethods: [{ id: 'copilot-login' }],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        mcpCapabilities: { http: true, sse: true },
      },
    })
  else if (m.method === 'session/new' || m.method === 'session/load') {
    if (process.env.COPILOT_PEER_SIGNED_OUT === '1') {
      send({ id: m.id, error: { code: -32000, message: 'Authentication required: not logged in' } })
      continue
    }
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old replay' } })
    update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact' }] })
    result(m.id, {
      sessionId: 'copilot-session',
      configOptions: config(),
      models: { currentModelId: model, availableModels: [{ modelId: model, name: 'GPT-5 mini' }] },
    })
  } else if (m.method === 'session/set_config_option') {
    if (m.params.configId === 'model') model = m.params.value
    if (m.params.configId === 'reasoning_effort') effort = m.params.value
    if (m.params.configId === 'allow_all') allow = m.params.value
    if (model === 'slow-model') setTimeout(() => result(m.id, { configOptions: config() }), 65)
    else result(m.id, { configOptions: config() })
  } else if (m.method === 'session/prompt') {
    active = m
    text = m.params.prompt.at(-1).text
    update({ sessionUpdate: 'usage_update', used: 17827, size: 128000 })
    if (text === 'hang' || text === 'steer') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'waiting' } })
      continue
    }
    if (text === 'slow tool') {
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'slow',
        title: 'Run',
        kind: 'execute',
        rawInput: { command: 'sleep 60' },
        status: 'in_progress',
      })
      continue
    }
    if (text === 'crash') process.exit(1)
    if (
      text === 'approval' ||
      text === 'edit approval' ||
      text === 'edit content approval' ||
      text === 'self tool' ||
      text === 'custom mcp'
    ) {
      if (text === 'self tool' || text === 'custom mcp')
        update({
          sessionUpdate: 'tool_call',
          toolCallId: 't',
          title: text === 'self tool' ? 'jetty-list_models' : 'Create a helper',
          kind: 'read',
          rawInput: {},
          status: 'pending',
        })
      const edit = text === 'edit approval' || text === 'edit content approval'
      send({
        id: 0,
        method: 'session/request_permission',
        params: {
          sessionId: 'copilot-session',
          toolCall: {
            toolCallId: 't',
            title:
              text === 'self tool'
                ? 'list_models'
                : text === 'custom mcp'
                  ? 'create_thread'
                  : edit
                    ? 'Edit marker'
                    : 'Run printf marker',
            kind:
              text === 'self tool' || text === 'custom mcp' ? 'other' : edit ? 'edit' : 'execute',
            rawInput: edit
              ? {
                  fileName: 'marker',
                  diff: '--- a/marker\n+++ b/marker\n@@ -1 +1 @@\n-before\n+after',
                }
              : { command: 'printf marker' },
            ...(text === 'edit content approval'
              ? { content: [{ type: 'diff', path: 'marker', oldText: 'before', newText: 'after' }] }
              : {}),
          },
          options: [
            { optionId: 'yes-once', kind: 'allow_once' },
            { optionId: 'yes-always', kind: 'allow_always' },
            { optionId: 'no-once', kind: 'reject_once' },
          ],
        },
      })
    } else if (text === 'error')
      send({ id: m.id, error: { code: -32000, message: 'Model quota exhausted' } })
    else if (text === '/compact') {
      if (process.env.COPILOT_PEER_COMPACT_FAILURE === '1')
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Failed to run /compact: Error: Nothing to compact.' },
        })
      else update({ sessionUpdate: 'usage_update', used: 1200, size: 128000 })
      result(m.id, { stopReason: 'end_turn' })
    } else {
      update(
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'foreign' } },
        'other'
      )
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking' } })
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 't',
        title: 'Run command',
        kind: 'execute',
        rawInput: { command: 'printf marker' },
        status: 'in_progress',
      })
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't',
        content: [{ type: 'content', content: { type: 'text', text: 'marker output' } }],
      })
      update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' })
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'edit',
        title: 'Creating marker',
        kind: 'edit',
        rawInput: { path: 'marker', file_text: 'hello' },
        locations: [{ path: 'marker', line: 1 }],
        content: [{ type: 'diff', path: 'marker', oldText: '', newText: 'hello' }],
        status: 'pending',
      })
      update({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'edit',
        status: 'completed',
        rawOutput: {
          content: 'File created',
          detailedContent: '--- a/marker\n+++ b/marker\n@@ -0,0 +1 @@\n+hello\n',
        },
      })
      update({ sessionUpdate: 'plan', entries: [{ content: 'Ship it', status: 'in_progress' }] })
      complete()
    }
  } else if (m.method === 'session/cancel') {
    if (text === 'hang') continue
    setTimeout(() => result(active!.id, { stopReason: 'cancelled' }), 5)
  } else if (!m.method && m.id === 0) {
    if (m.result?.outcome?.optionId === 'no-once') result(active!.id, { stopReason: 'cancelled' })
    else if (m.result?.outcome?.outcome === 'cancelled') continue
    else {
      if (text === 'self tool' || text === 'custom mcp')
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 't',
          status: 'completed',
          rawOutput: {
            content: text === 'custom mcp' ? '{"threadId":"child","created":true}' : '[]',
          },
        })
      complete()
    }
  } else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'unsupported' } })
}
