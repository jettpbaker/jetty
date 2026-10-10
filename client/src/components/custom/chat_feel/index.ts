import type { ChatFeel } from '@/lib/chat-feel'

import { stream as capy } from './capy'
import { stream as cursor } from './cursor'
import { jettyStream, type StreamFeel } from './jetty'
import './capy.css'
import './cursor.css'
import './hybrid.css'

export const streamFeels: Record<ChatFeel, StreamFeel> = {
  jetty: jettyStream,
  capy,
  cursor,
  hybrid: capy,
}
