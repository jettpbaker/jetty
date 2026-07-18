import { createSocket } from './socket'
import { createChromeStore } from './state/chrome'
import { createTimelineStore } from './state/timeline'

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${protocol}//${location.host}/ws`

export const socket = createSocket(wsUrl)
export const chromeStore = createChromeStore(socket)
export const timelineStore = createTimelineStore(socket)
