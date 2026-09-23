import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

import { SequencedEvent } from './events'
import { ThreadState } from './reducer'
import { ChromePushData, methods, type MethodName, WireError } from './wire'

export const ThreadUpdate = Schema.Union([
  Schema.Struct({ type: Schema.Literal('snapshot'), snapshot: ThreadState, seq: Schema.Natural }),
  Schema.Struct({ type: Schema.Literal('event'), ...SequencedEvent.fields }),
  Schema.Struct({ type: Schema.Literal('ready'), seq: Schema.Natural }),
])
export type ThreadUpdate = Schema.Schema.Type<typeof ThreadUpdate>

function unary<
  M extends Exclude<MethodName, 'chrome.subscribe' | 'thread.subscribe' | 'thread.unsubscribe'>,
>(name: M) {
  return Rpc.make<
    M,
    (typeof methods)[M]['params'],
    (typeof methods)[M]['result'],
    typeof WireError
  >(name, {
    payload: methods[name].params,
    success: methods[name].result,
    error: WireError,
  })
}

export const JettyRpcs = RpcGroup.make(
  unary('project.create'),
  unary('fs.browse'),
  unary('fs.search'),
  unary('skills.list'),
  unary('thread.create'),
  unary('thread.archive'),
  unary('thread.rename'),
  unary('thread.pin'),
  unary('thread.delete'),
  unary('thread.diff'),
  unary('turn.start'),
  unary('turn.interrupt'),
  unary('approval.respond'),
  unary('question.respond'),
  Rpc.make('chrome.subscribe', {
    payload: methods['chrome.subscribe'].params,
    success: ChromePushData,
    error: WireError,
    stream: true,
  }),
  Rpc.make('thread.subscribe', {
    payload: methods['thread.subscribe'].params,
    success: ThreadUpdate,
    error: WireError,
    stream: true,
  })
)
