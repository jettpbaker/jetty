import type { Attachment } from '@jetty/shared/items'

import {
  agentBehaviours,
  newId,
  type AgentBehaviours,
  type QueuedMessage,
} from '@jetty/shared/wire'

const base = [
  '# Jetty',
  "You're running inside Jetty, a local app where the user runs coding agents in threads. Each thread is one agent conversation in a project. It works either in its own git worktree, with its own branch and folder, or in the project checkout itself, which it shares with the user and any other threads there. The user follows threads from a sidebar that shows each one's status.",
  "To hand work to another agent, use create_thread. It starts a Jetty thread on any model list_models offers, including Codex and Grok. If the user or their instructions ask for a helper made another way, such as running `codex exec` or `grok -p`, or a subagent that only relays to one, create_thread is Jetty's native way to do that, so use it instead: the user can follow the thread in their sidebar, it survives restarts, and it reports back to you. Your own built-in subagents are a separate thing: keep using them for help within a turn, as you normally would.",
  "The thread you create is your child. It starts with only the prompt you give it, works on its own, and when it's done, Jetty sends its final message back to you. While your children work, end your turn instead of waiting or polling: their reports can't reach you until you do, and meanwhile the user sees you as Waiting. Text from another thread, or from Jetty itself, arrives inside <relayed-message> tags, so you can tell it from the user's own words.",
  'When you hand finished work back to the user, or need their decision, call mark_ready_for_review so the thread stands out in their sidebar. To mention a thread, link it as [title](jetty://threads/<id>). Link pull requests, issues and commits by their GitHub URLs. Jetty renders these as live links with their current status.',
]

export function jettyInstructions(behaviours: AgentBehaviours) {
  return [
    ...base,
    ...agentBehaviours.flatMap((behaviour) =>
      'instruction' in behaviour && behaviours[behaviour.key] ? [behaviour.instruction] : []
    ),
  ].join('\n\n')
}

// The message that opened a turn Jetty restarted before the agent started, so it never got it.
export type UndeliveredMessage = {
  text: string
  from?: { threadId: string; title: string }
  attachments: readonly Attachment[]
  fromCreator: boolean
}

// Jetty's note to an agent whose turn a restart cut off, sent first from its queue.
export function restartNote(
  threadId: string,
  stoppedNames: readonly string[] = [],
  undelivered?: UndeliveredMessage
): QueuedMessage {
  const names = stoppedNames.length ? `: ${stoppedNames.join(', ')}` : ''
  const stopped = `Anything you had running in the background (commands, monitors, subagents) was stopped and won't report back${names}.`
  const relayed = undelivered?.from?.threadId === threadId ? undefined : undelivered?.from
  return {
    id: newId(),
    text: undelivered
      ? `Jetty restarted before your last message reached you, so here it is${relayed ? `, from thread "${relayed.title}" (${relayed.threadId})` : ''}. ${stopped}\n\n${undelivered.text}${undelivered.fromCreator ? `\n\n${CHILD_REPORT_INSTRUCTION}` : ''}`
      : `Jetty restarted while you were working and cut off your last turn. ${stopped} Any approval or question you were waiting on was cancelled. Threads you created carry on and will still report back. Your last command may or may not have finished, so check the current state before redoing anything, then carry on.`,
    from: { threadId, title: 'Jetty' },
    kind: 'continuation',
    createdAt: Date.now(),
    hop: 0,
    ...(undelivered?.attachments.length && { attachments: [...undelivered.attachments] }),
  }
}

// Text from another thread, or from Jetty, in the tags jettyInstructions tells agents about.
export function relayedMessage(from: { threadId: string; title: string }, text: string) {
  return `<relayed-message from-thread-id="${escapeAttribute(from.threadId)}" from-title="${escapeAttribute(from.title)}">\n${text.replaceAll(/<\/relayed-message/gi, '&lt;/relayed-message')}\n</relayed-message>`
}

function escapeAttribute(value: string) {
  return value.replace(
    /[&"<>]/g,
    (char) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]!
  )
}

export const CHILD_REPORT_INSTRUCTION =
  "The thread that sent this created yours. When you're done, Jetty sends your final message back to it, so write that message for it. If you need its decision, ask it with ask_parent. Mention the attachment ids of any images or videos you showed, so it can re-post them."

export const REPORT_CAP = 20_000

export type ReportOutcome =
  | { type: 'finished' }
  | { type: 'interrupted' }
  | { type: 'failed'; error: string }
  | { type: 'paused' }
  | { type: 'asked'; question: string }

const outcomeText = {
  finished: () => 'finished.',
  interrupted: () => 'was interrupted by the user.',
  failed: (error: string) => `failed: ${error.trim().replace(/\.+$/, '')}.`,
  paused: () =>
    "is paused: Jetty kept restarting, so it didn't resume this thread. It continues when the user resumes it.",
  asked: () => 'has a question for you; answer it with send_message.',
}

// What a parent reads when its child is done. branch is null for a child in the project checkout.
export function childReport(report: {
  threadId: string
  title: string
  outcome: ReportOutcome
  branch: string | null
  message: string
  messageId?: string
}) {
  const { outcome, message } = report
  const status =
    outcome.type === 'failed' ? outcomeText.failed(outcome.error) : outcomeText[outcome.type]()
  const title = report.title.replace(/[[\]]/g, '\\$&')
  const where =
    report.branch === null ? 'Worked in the project checkout.' : `Branch: ${report.branch}`
  const body =
    outcome.type === 'asked'
      ? outcome.question
      : message.length > REPORT_CAP
        ? `${message.slice(0, REPORT_CAP)}\n[Cut at ${REPORT_CAP.toLocaleString('en-US')} characters; read_thread with messageId ${report.messageId} has the rest.]`
        : message
  return [`[${title}](jetty://threads/${report.threadId}) ${status}\n${where}`, body]
    .filter(Boolean)
    .join('\n\n')
}

export function deniedApprovalNote(note: string) {
  return `User's note on the denied approval: ${note}`
}

export function userAnswers(lines: readonly string[]) {
  return ['Answers from the user:', ...lines].join('\n')
}
