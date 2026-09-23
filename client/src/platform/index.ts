import { browser } from './browser'

export type { PickFilesOptions, Platform, PlatformStorage } from './types'

export const { connectionUrl, pickFiles, storage, openExternal } = browser
