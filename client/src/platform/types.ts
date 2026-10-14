export type Platform = {
  reload: () => void
  connectionUrl: (reconnecting: boolean) => Promise<string>
  // A desktop's viewer, proxied on Jetty's own origin.
  desktopUrl: (id: string) => string
  pickFiles: (options?: { accept?: string; multiple?: boolean }) => Promise<File[]>
  databases: {
    open: (
      name: string,
      version: number,
      upgrade: (database: IDBDatabase) => void
    ) => Promise<IDBDatabase>
  }
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
