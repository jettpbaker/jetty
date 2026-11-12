import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import {
  useBot,
  usePendingBotMessages,
  useSendingIds,
  useSendToBot,
  useSendTurn,
  useThreadMeta,
} from '@/state'
import { useProviderUnavailable } from '@/state/models'
import { useTurnRetry } from '@/state/threads'

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
  const turn = useTurnRetry(threadId, turnId)
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
  const { sent } = turn
  // A thread's own send can't carry attachments it has already stored; a bot's can.
  const retryable = sent !== undefined && (isBot || sent.attachments.length === 0)
  const failed = retryable && turn.failed && sending.length === 0 && pendingBot.length === 0
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
