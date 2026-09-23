import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const server = `http://127.0.0.1:${process.env.JETTY_SERVER_PORT ?? '8787'}`

function websocketSecret(): Plugin {
  return {
    name: 'jetty-websocket-secret',
    apply: 'serve',
    async transformIndexHtml(html) {
      const response = await fetch(server)
      if (!response.ok) throw new Error('Jetty server is unavailable')
      const secret = (await response.text()).match(
        /<meta name="jetty-ws-secret" content="([a-f0-9]+)">/
      )?.[1]
      if (!secret) throw new Error('Jetty WebSocket secret is unavailable')
      return html.replace('</head>', `<meta name="jetty-ws-secret" content="${secret}"></head>`)
    },
  }
}

type IconifyIcon = { body: string; width?: number; height?: number }
type IconifySet = {
  icons: Record<string, IconifyIcon>
  aliases?: Record<string, { parent: string; hFlip?: boolean }>
  width?: number
  height?: number
}

// Fluent Emoji (Flat) served locally as /fluent-emoji/<codepoints>.svg, fe0f dropped to match
// the iconify set's chars.json. Written straight to disk: 3k emitFile assets flood the build log.
function fluentEmoji(): Plugin {
  const require = createRequire(import.meta.url)
  const virtualId = 'virtual:fluent-emoji'
  let cache: { chars: Record<string, string>; set: IconifySet } | undefined
  function data() {
    return (cache ??= {
      chars: require('@iconify-json/fluent-emoji-flat/chars.json'),
      set: require('@iconify-json/fluent-emoji-flat/icons.json'),
    })
  }
  function svg(code: string) {
    const { chars, set } = data()
    const alias = set.aliases?.[chars[code] ?? '']
    const icon = set.icons[alias?.parent ?? chars[code] ?? '']
    if (!icon) return undefined
    const width = icon.width ?? set.width ?? 32
    const height = icon.height ?? set.height ?? 32
    const body = alias?.hFlip
      ? `<g transform="translate(${width} 0) scale(-1 1)">${icon.body}</g>`
      : icon.body
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`
  }
  function missing() {
    const picker: {
      emojis: Record<string, { u: string }[]>
    } = require('emoji-picker-react/dist/data/emojis.json')
    return Object.values(picker.emojis)
      .flat()
      .map((emoji) => emoji.u)
      .filter((unified) => !data().chars[unified.replaceAll('-fe0f', '')])
  }
  return {
    name: 'fluent-emoji',
    resolveId: (id) => (id === virtualId ? `\0${virtualId}` : undefined),
    load: (id) =>
      id === `\0${virtualId}`
        ? `export const missingEmoji = ${JSON.stringify(missing())}`
        : undefined,
    configureServer(dev) {
      dev.middlewares.use('/fluent-emoji/', (request, response, next) => {
        const source = svg(request.url?.slice(1).replace(/\.svg$/, '') ?? '')
        if (!source) return next()
        response.setHeader('Content-Type', 'image/svg+xml')
        response.end(source)
      })
    },
    writeBundle({ dir = 'dist' }) {
      const out = join(dir, 'fluent-emoji')
      mkdirSync(out, { recursive: true })
      for (const code of Object.keys(data().chars)) {
        const source = svg(code)
        if (source) writeFileSync(join(out, `${code}.svg`), source)
      }
    },
  }
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react({ compiler: { target: '19' } }),
    tailwindcss(),
    fluentEmoji(),
    websocketSecret(),
  ],
  server: {
    port: Number(process.env.JETTY_CLIENT_PORT ?? 5173),
    proxy: {
      '/ws': { target: server, ws: true },
      '/attachments': { target: server },
    },
  },
})
