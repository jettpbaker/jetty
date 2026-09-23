import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const server = 'http://127.0.0.1:8787'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react({ compiler: { target: '19' } }),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: server, ws: true },
      '/attachments': { target: server },
    },
  },
})
