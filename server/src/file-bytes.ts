import type { FileHandle } from 'node:fs/promises'

export async function readBounded(handle: FileHandle, limit: number) {
  const bytes = Buffer.alloc(limit + 1)
  let offset = 0
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
    if (!bytesRead) break
    offset += bytesRead
  }
  return bytes.subarray(0, offset)
}

export async function copyOpened(source: FileHandle, destination: FileHandle) {
  const size = (await source.stat()).size
  const bytes = Buffer.alloc(64 * 1024)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await source.read(bytes, 0, Math.min(bytes.length, size - offset), offset)
    if (!bytesRead) break
    await destination.writeFile(bytes.subarray(0, bytesRead))
    offset += bytesRead
  }
}
