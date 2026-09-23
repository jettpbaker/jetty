import { browser } from './browser'

export type { PickFilesOptions, Platform, PlatformBlobs, PlatformStorage } from './types'

export const { connectionUrl, pickFiles, storage, blobs, openExternal } = browser
