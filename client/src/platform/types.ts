export type PickFilesOptions = {
  accept?: string
  multiple?: boolean
}

export type PlatformStorage = {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void
  remove: (key: string) => void
}

export type Platform = {
  connectionUrl: () => string
  pickFiles: (options?: PickFilesOptions) => Promise<File[]>
  storage: PlatformStorage
  openExternal: (url: string) => void
}
