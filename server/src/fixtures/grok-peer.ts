import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

writeFileSync('peer.pid', String(process.pid))
let active: any
let question = false
function send(message: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...(message as object) }) + '\n')
}
function result(id: unknown, value: unknown = {}) {
  send({ id, result: value })
}
function update(value: unknown, sessionId = 'grok-session') {
  send({ method: 'session/update', params: { sessionId, update: value } })
}
function complete() {
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello 🛶' } })
  result(active.id, { stopReason: 'end_turn' })
}
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line)
  appendFileSync('peer.jsonl', JSON.stringify(m) + '\n')
  if (m.method === 'initialize')
    result(m.id, {
      authMethods: [{ id: 'cached_token' }, { id: 'xai.api_key' }],
      agentCapabilities: { loadSession: true },
    })
  else if (m.method === 'authenticate' || m.method === 'session/set_model') result(m.id)
  else if (m.method === 'session/new' || m.method === 'session/load') {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old replay' } })
    result(m.id, { sessionId: 'grok-session', models: { currentModelId: 'real-model' } })
  } else if (m.method === 'session/prompt') {
    active = m
    const text = m.params.prompt[0].text
    if (text === 'hang' || text === 'steer') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'waiting' } })
      continue
    }
    if (text === 'crash') process.exit(1)
    if (text === 'approval')
      send({
        id: 'approval',
        method: 'session/request_permission',
        params: {
          sessionId: 'grok-session',
          toolCall: { title: 'Read marker', kind: 'read', rawInput: { path: 'marker' } },
          options: [
            { optionId: 'yes-once', kind: 'allow_once' },
            { optionId: 'no-once', kind: 'reject_once' },
          ],
        },
      })
    else if (text === 'question') {
      question = true
      send({
        id: 'question',
        method: '_x.ai/ask_user_question',
        params: {
          sessionId: 'grok-session',
          questions: [
            {
              id: 'q1',
              question: 'Which?',
              multiSelect: true,
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        },
      })
    } else if (text === 'plan')
      send({ id: 'plan', method: 'x.ai/exit_plan_mode', params: { sessionId: 'grok-session' } })
    else if (text === 'extension' || text === 'rate_limit') {
      update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'extension text' },
      })
      send({
        method: '_x.ai/session/prompt_complete',
        params: {
          sessionId: 'grok-session',
          promptId: m.params._meta.promptId,
          stopReason: text === 'rate_limit' ? 'rate_limit' : 'end_turn',
        },
      })
    } else {
      update(
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'foreign' } },
        'other'
      )
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 't',
        title: 'Read',
        rawInput: { path: 'marker' },
        status: 'in_progress',
      })
      update({ sessionUpdate: 'tool_call_update', toolCallId: 't', rawOutput: 'marker output' })
      update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' })
      complete()
    }
  } else if (m.method === 'session/cancel') {
    if (active.params.prompt[0].text === 'hang') continue
    result(active.id, { stopReason: 'cancelled' })
    send({
      method: '_x.ai/session/prompt_complete',
      params: {
        sessionId: 'grok-session',
        promptId: active.params._meta.promptId,
        stopReason: 'cancelled',
      },
    })
  } else if (!m.method && (m.id === 'approval' || m.id === 'question' || m.id === 'plan')) {
    if (question) question = false
    complete()
  } else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'unsupported' } })
}
