// Builds the client in the cwd (a lab tree's client/) with the lab's perf mode: React's
// profiling build, so its Scheduler and Components tracks show in traces, and hidden
// sourcemaps for analysis. The app's own vite config is used unchanged underneath.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = process.cwd()
const vite: { build(config: Record<string, unknown>): Promise<unknown> } = await import(
  createRequire(join(root, 'package.json')).resolve('vite')
)

await vite.build({
  root,
  configFile: join(root, 'vite.config.ts'),
  mode: 'perf',
  logLevel: 'error',
  resolve: { alias: [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] },
  build: { sourcemap: 'hidden', outDir: 'dist', emptyOutDir: true },
})
