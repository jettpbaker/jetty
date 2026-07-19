import { createSocket } from './socket'
import { createChromeStore } from './state/chrome'
import { createDraftsStore } from './state/drafts'
import { persistChrome, persistDrafts, persistTabs, persistThread } from './state/persist'
import { createTabsStore } from './state/tabs'
import { createTimelineStore } from './state/timeline'

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${protocol}//${location.host}/ws`

export const socket = createSocket(wsUrl)
export const chromeStore = createChromeStore(socket, persistChrome)
export const tabsStore = createTabsStore(persistTabs)
export const draftsStore = createDraftsStore(persistDrafts)
export const timelineStore = createTimelineStore(socket, persistThread)
