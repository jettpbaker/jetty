import { expect, test } from 'bun:test'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { copyOpened, readBounded } from './file-bytes'

test('reads stop at cap plus one even when the file grew after its size check', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jetty-bounded-'))
  const handle = await open(join(root, 'file'), 'w+')
  try {
    await handle.writeFile('small')
    expect((await handle.stat()).size).toBe(5)
    await handle.writeFile(Buffer.alloc(100_000, 65))
    expect((await readBounded(handle, 1024)).length).toBe(1025)
    await handle.truncate(5)
    expect(await readBounded(handle, 1024)).toEqual(Buffer.from('small'))
  } finally {
    await handle.close()
    await rm(root, { recursive: true })
  }
})

test('oversized recovery streams the complete file from the start of an already-read handle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jetty-recovery-'))
  const source = await open(join(root, 'source'), 'w+')
  const destination = await open(join(root, 'destination'), 'w+')
  try {
    const bytes = Buffer.alloc(1024 * 1024 + 37, 65)
    await source.writeFile(bytes)
    await source.read(Buffer.alloc(16), 0, 16, null)
    await copyOpened(source, destination)
    expect(await destination.readFile()).toEqual(Buffer.alloc(0))
    expect(await readBounded(destination, bytes.length)).toEqual(bytes)
  } finally {
    await source.close()
    await destination.close()
    await rm(root, { recursive: true })
  }
})
