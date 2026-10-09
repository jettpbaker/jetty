import type { ChatFeel } from '@/lib/chat-feel'

import { stream as capy } from './capy'
import { stream as cursor } from './cursor'
import { jettyStream, type StreamFeel } from './jetty'
import { stream as opencode } from './opencode'
import './capy.css'
import './cursor.css'
import './opencode.css'

export const streamFeels: Record<ChatFeel, StreamFeel> = {
  jetty: jettyStream,
  capy,
  cursor,
  opencode,
}
