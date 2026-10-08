import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/bots/$botId')({ component: BotChatRoute })

function BotChatRoute() {
  return null
}
