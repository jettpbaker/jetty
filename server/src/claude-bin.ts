import { delimiter } from 'node:path'

// cmux's per-terminal shim injects its own --session-id and hooks into every claude it launches.
const PATH = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((dir) => !dir.includes('/cmux-cli-shims/'))
  .join(delimiter)

// The SDK spawns this without a shell, so resolve it to an absolute path; undefined falls back to its bundled CLI.
export const claudeBin = Bun.which(process.env.JETTY_CLAUDE_BIN || 'claude', { PATH }) ?? undefined
