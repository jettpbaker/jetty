// The SDK spawns this path without a shell, so it must be absolute; undefined falls back to its bundled CLI.
export const claudeBin = process.env.JETTY_CLAUDE_BIN || Bun.which('claude') || undefined
