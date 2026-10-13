import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import {
  useBot,
  usePendingBotMessages,
  useSendingIds,
  useSendToBot,
  useSendTurn,
  useThread,
  useThreadMeta,
} from '@/state'
import { useProviderUnavailable } from '@/state/models'

import { ArrowRotateClockwiseIcon } from './central_icons'
import { DisabledTooltip } from './disabled_tooltip'
import { providerNames } from './usage_limits'

// A failed turn, with Retry under it while it is the latest turn and the thread is idle.
export function ErrorMessage({
  message,
  threadId,
  turnId,
}: {
  message: string
  threadId: string
  turnId: string
}) {
  const thread = useThread(threadId)
  const isBot = useBot(threadId) !== undefined
  const provider = useThreadMeta(threadId)?.provider
  const providerUnavailable = useProviderUnavailable(provider)
  const unavailable =
    !isBot && provider && providerUnavailable
      ? `Connect ${providerNames[provider]} in Settings to retry this turn`
      : undefined
  const sending = useSendingIds(threadId)
  const pendingBot = usePendingBotMessages(threadId)
  const sendTurn = useSendTurn()
  const sendToBot = useSendToBot()
  const sent = thread?.items.findLast(
    (item) => item.turnId === turnId && item.kind === 'user_message' && !item.from
  )
  const first = thread?.items.find((item) => item.turnId === turnId && item.kind === 'user_message')
  // A thread's own send can't carry attachments it has already stored; a bot's can.
  const retryable =
    sent?.kind === 'user_message' &&
    first?.kind === 'user_message' &&
    !first.from &&
    (isBot || sent.attachments.length === 0)
  const latest = thread && Object.keys(thread.turnOutcomes).at(-1) === turnId
  const failed =
    retryable &&
    latest &&
    thread.lastTurnOutcome === 'failed' &&
    !thread.activeTurnId &&
    sending.length === 0 &&
    pendingBot.length === 0
  function retry() {
    if (!failed || unavailable) return
    if (isBot) sendToBot(threadId, sent.text, sent.replies, sent.attachments)
    else sendTurn(threadId, sent.text, undefined, [], sent.replies)
  }
  return (
    <Message align='start'>
      <MessageContent className='gap-0'>
        <p className='text-sm text-destructive'>{message}</p>
        {failed && (
          <DisabledTooltip reason={unavailable} wrap='self-start'>
            <Button
              variant='ghost-text'
              size='xs'
              className='-ml-3 self-start'
              onClick={retry}
              disabled={!!unavailable}
            >
              <ArrowRotateClockwiseIcon />
              Retry
            </Button>
          </DisabledTooltip>
        )}
      </MessageContent>
    </Message>
  )
}
