// Builds the client in the cwd (a lab tree's client/) in the lab's perf mode: hidden
// sourcemaps for mapping counts and traces back to source, and with --profiling React's
// profiling build, whose Scheduler and Components tracks show in traces. Measured runs use the
// production React: the profiling build's timers make commit work depend on elapsed time. The
// app's own vite config is used unchanged underneath.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = process.cwd()
const profiling = Bun.argv.includes('--profiling')
const vite: { build(config: Record<string, unknown>): Promise<unknown> } = await import(
  createRequire(join(root, 'package.json')).resolve('vite')
)

await vite.build({
  root,
  configFile: join(root, 'vite.config.ts'),
  mode: 'perf',
  logLevel: 'error',
  resolve: profiling
    ? { alias: [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] }
    : {},
  build: { sourcemap: 'hidden', outDir: 'dist', emptyOutDir: true },
})
