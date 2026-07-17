import { createSocket } from './socket'
import { createChromeStore } from './state/chrome'
import { createTimelineStore } from './state/timeline'

function wsUrl(): string {
  if (typeof location === 'undefined') {
    return 'ws://127.0.0.1:8787/ws'
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

export const socket = createSocket(wsUrl())
export const chromeStore = createChromeStore(socket)
export const timelineStore = createTimelineStore(socket)
