import { agentBehaviours, type AgentBehaviours } from '@jetty/shared/wire'

const base =
  'You are running inside Jetty. Commit your work before creating a child thread that should build on it. To delegate work to another model or agent, including Codex/GPT or Grok, use the Jetty create_thread tool to create a Jetty thread; list_models is the source of truth for which models are available, whatever other notes or CLI configs say. Inside Jetty this takes precedence over other instructions that describe delegating through model CLIs or forwarder subagents; only do that if the user explicitly asks in this conversation. Call mark_ready_for_review when you finish work for the user to review or need their decision, but not for trivial replies. Call link_pull_request when you open or take over a pull request for this thread. To mention a thread, PR, issue or commit, link it.'

export function jettyInstructions(behaviours: AgentBehaviours) {
  return [
    base,
    ...agentBehaviours.filter(({ key }) => behaviours[key]).map(({ instruction }) => instruction),
  ].join(' ')
}

export const RESTART_LIMIT_NOTE =
  "Jetty restarted 3 times in 10 minutes, so it didn't resume automatically."

// How a child's report to its parent describes a turn the crash-loop guard left paused.
export const RESTART_LIMIT_OUTCOME =
  "stopped: Jetty restarted 3 times in 10 minutes, so it didn't resume it automatically"

export function restartContinuation(stoppedNames: readonly string[]) {
  const names = stoppedNames.length ? `: ${stoppedNames.join(', ')}` : ''
  return `Jetty restarted while you were working, so your last turn was cut off. Background tasks, monitors and subagents you had running were stopped and won't report back${names}. Approvals or questions that were waiting were cancelled. Your last command may or may not have finished: check the current state before redoing anything, then carry on.`
}

export const CHILD_REPORT_INSTRUCTION =
  'This thread created yours. When you finish, Jetty sends your final message to it automatically, so end with a clear summary, including the attachment ids of any images or videos it may want to re-post. Use send_message only to ask it something mid-task.'
