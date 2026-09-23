export type Platform = {
  connectionUrl: () => string
  pickFiles: (options?: { accept?: string; multiple?: boolean }) => Promise<File[]>
  storage: {
    get: (key: string) => string | undefined
    set: (key: string, value: string) => void
    remove: (key: string) => void
  }
  blobs: {
    get: (key: string) => Promise<Blob | undefined>
    put: (key: string, blob: Blob) => Promise<void>
    remove: (key: string) => Promise<void>
  }
}
