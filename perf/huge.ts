import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const hugeRef = { repo: 'oven-sh/bun', number: 30412 }
export const hugeFixtures = join(homedir(), 'Library/Caches/jetty-perf/gh-huge')
export const hugeManifest = join(hugeFixtures, 'recording.json')

export function hasHugeFixtures() {
  return existsSync(hugeManifest)
}
