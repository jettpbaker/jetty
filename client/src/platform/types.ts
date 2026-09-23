export type Platform = {
  connectionUrl: (reconnecting: boolean) => Promise<string>
  pickFiles: (options?: { accept?: string; multiple?: boolean }) => Promise<File[]>
  storage: {
    get: (key: string) => string | undefined
    set: (key: string, value: string) => boolean
    remove: (key: string) => void
  }
  session: {
    get: (key: string) => string | undefined
    set: (key: string, value: string) => boolean
    remove: (key: string) => void
  }
  blobs: {
    get: (key: string) => Promise<Blob | undefined>
    put: (key: string, blob: Blob) => Promise<void>
    remove: (key: string) => Promise<void>
  }
}
