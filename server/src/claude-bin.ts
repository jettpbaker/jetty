import { delimiter } from 'node:path'

import { blockedCli, providerCli } from './provider-cli'

// cmux's per-terminal shim injects its own --session-id and hooks into every claude it launches.
const PATH = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((dir) => !dir.includes('/cmux-cli-shims/'))
  .join(delimiter)

const command = process.env.JETTY_CLAUDE_BIN || providerCli('claude', 'JETTY_LIVE_TEST')

// The SDK spawns this without a shell, so resolve it to an absolute path; undefined falls back to its bundled CLI.
export const claudeBin =
  command === blockedCli ? blockedCli : (Bun.which(command, { PATH }) ?? undefined)
