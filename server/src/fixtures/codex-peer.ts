import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const threadId = 'provider-thread'
const turnId = 'provider-turn'
let scenario = ''
let pending = ''
writeFileSync('peer.pid', String(process.pid))

function send(value: unknown) {
  const line = JSON.stringify(value) + '\n'
  // Split every envelope to exercise framing independently of OS pipe boundaries.
  process.stdout.write(line.slice(0, 7))
  process.stdout.write(line.slice(7))
}
function notify(method: string, params: object) {
  send({ method, params: { threadId, turnId, ...params } })
}
function complete(status = 'completed') {
  notify('turn/completed', {
    turn: {
      id: turnId,
      status,
      error: status === 'failed' ? { message: 'fixture provider failure' } : null,
    },
  })
}
function answer(text: string) {
  notify('item/started', { item: { id: 'answer', type: 'agentMessage', text: '' } })
  notify('item/agentMessage/delta', { itemId: 'answer', delta: text.slice(0, 3) })
  notify('item/agentMessage/delta', { itemId: 'answer', delta: text.slice(3) })
  notify('item/completed', { item: { id: 'answer', type: 'agentMessage', text } })
  complete()
}

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  appendFileSync('peer.jsonl', JSON.stringify(message) + '\n')
  const { method, id, params } = message
  if (method === 'initialize') {
    if (process.argv[2] !== 'silent-init') send({ id, result: { userAgent: 'fixture' } })
  } else if (method === 'thread/start' || method === 'thread/resume') {
    if (params.threadId === 'missing')
      send({ id, error: { code: -32000, message: 'Thread not found' } })
    else send({ id, result: { thread: { id: threadId } } })
  } else if (method === 'turn/start') {
    scenario = params.input[0].text
    if (scenario === 'start-error') {
      send({ id, error: { code: -32000, message: 'Model unavailable' } })
      continue
    }
    send({ id, result: { turn: { id: turnId, status: 'inProgress' } } })
    notify('turn/started', { turn: { id: turnId } })
    if (scenario === 'crash') process.exit(7)
    else if (scenario === 'malformed') process.stdout.write('{broken\n')
    else if (scenario === 'failure') complete('failed')
    else if (scenario === 'approval' || scenario === 'question' || scenario === 'unsupported') {
      pending = scenario
      const method =
        scenario === 'approval'
          ? 'item/commandExecution/requestApproval'
          : scenario === 'question'
            ? 'item/tool/requestUserInput'
            : 'item/permissions/requestApproval'
      send({
        id: 'approval-1',
        method,
        params: {
          threadId,
          turnId,
          itemId: 'tool',
          command: 'echo test',
          questions: [
            {
              id: 'choice',
              header: 'Choice',
              question: 'Which one?',
              isSecret: false,
              options: [{ label: 'A', description: 'First' }],
            },
          ],
        },
      })
    } else if (scenario === 'hold' || scenario === 'ignore-interrupt') {
      notify('item/started', { item: { id: 'waiting', type: 'agentMessage', text: '' } })
    } else {
      notify('item/started', {
        threadId: 'unrelated',
        item: { id: 'bad', type: 'agentMessage', text: 'Do not show' },
      })
      notify('item/started', {
        item: {
          id: 'cmd',
          type: 'commandExecution',
          command: 'cat fixture',
          cwd: process.cwd(),
          status: 'inProgress',
        },
      })
      notify('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'output' })
      notify('item/completed', {
        item: {
          id: 'cmd',
          type: 'commandExecution',
          command: 'cat fixture',
          status: 'completed',
          aggregatedOutput: 'output',
          exitCode: 0,
        },
      })
      notify('thread/tokenUsage/updated', {
        tokenUsage: {
          last: { totalTokens: 120 },
          total: { inputTokens: 100, outputTokens: 20 },
          modelContextWindow: 200000,
        },
      })
      answer('Hello 🛶')
    }
  } else if (method === 'turn/steer') {
    send({ id, result: { turnId } })
    answer(params.input[0].text)
  } else if (method === 'turn/interrupt') {
    if (scenario !== 'ignore-interrupt') {
      send({ id, result: {} })
      complete('interrupted')
    }
  } else if (id === 'approval-1')
    answer(JSON.stringify({ pending, result: message.result, error: message.error }))
}
