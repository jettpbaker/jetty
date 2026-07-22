import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // bare `shiki` only — subpaths like shiki/core stay on the real package.
      // Keeps @pierre/diffs (and anything else) on our trimmed language set.
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL('./src/lib/shiki-shim.ts', import.meta.url)),
      },
    ],
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:8787',
        ws: true,
      },
      '/attachments': {
        target: 'http://127.0.0.1:8787',
      },
    },
  },
})
