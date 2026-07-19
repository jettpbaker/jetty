const DEFAULT_LIMIT = 20

/**
 * Case-insensitive subsequence match. Higher score is better; null means no match.
 * Prefers basename hits, contiguous runs, then shorter paths.
 */
export function fuzzyMatch(path: string, query: string): number | null {
  if (query.length === 0) return null

  const p = path.toLowerCase()
  const q = query.toLowerCase()
  const basenameStart = p.lastIndexOf('/') + 1

  let pi = 0
  let score = 0
  let run = 0
  let basenameHits = 0

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    let found = -1
    for (let j = pi; j < p.length; j++) {
      if (p[j] === ch) {
        found = j
        break
      }
    }
    if (found < 0) return null

    // consecutive path chars matching consecutive query chars
    if (qi > 0 && found === pi) {
      run++
      score += 5 + run
    } else {
      run = 0
      score += 1
    }

    if (found >= basenameStart) basenameHits++
    pi = found + 1
  }

  score += basenameHits * 10
  // light length penalty so shorter paths win ties
  score -= p.length * 0.001
  return score
}

async function gitLsFiles(cwd: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(['git', 'ls-files'], { cwd, stdout: 'pipe', stderr: 'ignore' })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) return []
    return out.split('\n').filter((line) => line.length > 0)
  } catch {
    return []
  }
}

/** Fuzzy-search git-tracked files under cwd. Empty query / non-git / failure → []. */
export async function searchFiles(
  cwd: string,
  query: string,
  limit: number = DEFAULT_LIMIT
): Promise<string[]> {
  if (query.length === 0) return []
  const files = await gitLsFiles(cwd)
  if (files.length === 0) return []

  const scored: { path: string; score: number }[] = []
  for (const path of files) {
    const score = fuzzyMatch(path, query)
    if (score !== null) scored.push({ path, score })
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return scored.slice(0, limit).map((s) => s.path)
}
