import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const ROOT_FILES = ['brief.md', 'index.md', 'preferences.md']

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.7z',
  '.mp4',
  '.mov',
  '.mp3',
  '.wav',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.sqlite',
  '.db',
  '.bin',
  '.wasm',
  '.parquet',
])

const TEXT_EXT = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.log', '.tsv'])

export type MemoryFile = { rel: string; abs: string; bytes: Uint8Array }

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isBinary(rel: string, bytes: Uint8Array): boolean {
  if (BINARY_EXT.has(extname(rel).toLowerCase())) return true
  const n = Math.min(bytes.length, 8000)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

export async function listMemoryFiles(home: string): Promise<MemoryFile[]> {
  const out: MemoryFile[] = []
  for (const name of ROOT_FILES) {
    const file = await readTextFile(join(home, name), name, 'md')
    if (file) out.push(file)
  }
  await walkDir(join(home, 'pages'), 'pages', out, 'md')
  await walkDir(join(home, 'log'), 'log', out, 'md')
  await walkDir(join(home, 'files'), 'files', out, 'text')
  out.sort((a, b) => a.rel.localeCompare(b.rel))
  return out
}

async function walkDir(
  absDir: string,
  relDir: string,
  out: MemoryFile[],
  mode: 'md' | 'text'
): Promise<void> {
  let entries
  try {
    if ((await lstat(absDir)).isSymbolicLink()) return
    entries = await readdir(absDir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(absDir, entry.name)
    const rel = `${relDir}/${entry.name}`
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await walkDir(abs, rel, out, mode)
      continue
    }
    if (!entry.isFile()) continue
    const file = await readTextFile(abs, rel, mode)
    if (file) out.push(file)
  }
}

async function readTextFile(
  abs: string,
  rel: string,
  mode: 'md' | 'text'
): Promise<MemoryFile | null> {
  if (mode === 'md' && !rel.endsWith('.md')) return null
  if (mode === 'text') {
    const ext = extname(rel).toLowerCase()
    if (ext && !TEXT_EXT.has(ext)) return null
  }
  let bytes: Uint8Array
  try {
    if (!(await lstat(abs)).isFile()) return null
    bytes = new Uint8Array(await readFile(abs))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (isBinary(rel, bytes)) return null
  return { rel, abs, bytes }
}
