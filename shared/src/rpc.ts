import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { SequencedEvent } from './events'
import { ThreadState } from './reducer'
import {
  ChromePushData,
  methods,
  type MethodName,
  PullRequestList,
  PullRequestSnapshot,
  WireError,
} from './wire'

export const ThreadUpdate = Schema.Union([
  Schema.Struct({ type: Schema.Literal('snapshot'), snapshot: ThreadState, seq: Schema.Natural }),
  Schema.Struct({ type: Schema.Literal('event'), ...SequencedEvent.fields }),
  Schema.Struct({ type: Schema.Literal('ready'), seq: Schema.Natural }),
])
export type ThreadUpdate = Schema.Schema.Type<typeof ThreadUpdate>

function unary<
  M extends Exclude<
    MethodName,
    | 'chrome.subscribe'
    | 'github.activity'
    | 'thread.subscribe'
    | 'pullRequest.subscribe'
    | 'pullRequestList.subscribe'
  >,
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
  unary('settings.providerUsage'),
  unary('models.refresh'),
  unary('settings.setBranchPrefix'),
  unary('project.branches'),
  unary('thread.worktreeChanges'),
  unary('thread.retrySetup'),
  unary('thread.compact'),
  unary('thread.continue'),
  unary('settings.setTitleModel'),
  unary('settings.setAgentBehaviour'),
  unary('project.create'),
  unary('project.delete'),
  unary('project.setIcon'),
  unary('project.rename'),
  unary('fs.browse'),
  unary('fs.search'),
  unary('skills.list'),
  unary('thread.create'),
  unary('thread.archive'),
  unary('thread.rename'),
  unary('thread.pin'),
  unary('thread.markSeen'),
  unary('thread.delete'),
  unary('thread.diff'),
  unary('thread.diffFile'),
  unary('thread.readFile'),
  unary('thread.readDirectory'),
  unary('thread.writeFile'),
  unary('pullRequest.link'),
  unary('github.connection'),
  unary('pullRequest.unlink'),
  unary('pullRequest.get'),
  unary('pullRequest.guide'),
  unary('pullRequest.prefetch'),
  unary('issue.prefetch'),
  unary('pullRequest.refresh'),
  unary('pullRequest.diffFile'),
  unary('pullRequest.reviewerCandidates'),
  unary('pullRequest.setReviewRequest'),
  unary('pullRequest.updateTitle'),
  unary('pullRequest.merge'),
  unary('pullRequest.updateBody'),
  unary('pullRequest.setState'),
  unary('pullRequest.comment'),
  unary('pullRequest.reply'),
  unary('pullRequest.resolveThread'),
  unary('pullRequest.setViewed'),
  unary('pullRequest.commitFiles'),
  unary('pullRequest.uploadAttachment'),
  unary('pullRequestList.prefetch'),
  unary('pullRequestList.refresh'),
  unary('queue.add'),
  unary('queue.remove'),
  unary('queue.restore'),
  unary('queue.edit'),
  unary('queue.hold'),
  unary('queue.release'),
  unary('queue.sendNow'),
  unary('turn.start'),
  unary('turn.interrupt'),
  unary('workflow.stop'),
  unary('background.stop'),
  unary('approval.respond'),
  unary('question.respond'),
  unary('question.dismiss'),
  unary('bot.create'),
  unary('bot.update'),
  unary('bot.conversation'),
  unary('bot.send'),
  unary('bot.markSeen'),
  unary('bot.setAllowRules'),
  Rpc.make('chrome.subscribe', {
    payload: methods['chrome.subscribe'].params,
    success: ChromePushData,
    error: WireError,
    stream: true,
  }),
  // Emits nothing: it reports the window's attention for as long as it stays open.
  Rpc.make('github.activity', {
    payload: methods['github.activity'].params,
    success: Schema.Never,
    error: WireError,
    stream: true,
  }),
  Rpc.make('thread.subscribe', {
    payload: methods['thread.subscribe'].params,
    success: ThreadUpdate,
    error: WireError,
    stream: true,
  }),
  Rpc.make('pullRequest.subscribe', {
    payload: methods['pullRequest.subscribe'].params,
    success: PullRequestSnapshot,
    error: WireError,
    stream: true,
  }),
  Rpc.make('pullRequestList.subscribe', {
    payload: methods['pullRequestList.subscribe'].params,
    success: PullRequestList,
    error: WireError,
    stream: true,
  })
)
