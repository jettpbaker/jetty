import type { Attachment } from '@jetty/shared/items'

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { MAX_GALLERY_IMAGES } from '@jetty/shared/items'
import { newId } from '@jetty/shared/wire'
import { resolve } from 'node:path'
import { z } from 'zod'

import type { MediaToolHost } from './media-host'

import { createSendVideoTool } from './send-video'

export const SEND_IMAGES_TOOL = 'mcp__jetty__send_images'
export type { MediaToolHost }

const SEND_IMAGES_DESCRIPTION =
  "Show the user screenshots or other images in the chat (for example, to verify UI changes). Paths may be absolute or relative to the project root. Up to 4 images render as a gallery. Supported formats: png, jpg, gif, webp. Images are copied into jetty's store, so temporary files may be deleted afterwards."

export function createSendImagesTool(host: MediaToolHost) {
  return tool(
    'send_images',
    SEND_IMAGES_DESCRIPTION,
    {
      paths: z
        .array(z.string())
        .min(1)
        .max(MAX_GALLERY_IMAGES)
        .describe('Absolute paths or paths relative to the project root (1–4 image files)'),
      caption: z.string().optional().describe('Optional caption shown with the gallery'),
    },
    async (args) => {
      const images: Attachment[] = []
      const copied: string[] = []
      try {
        for (const p of args.paths) {
          const attachment = host.attachments.persistFile(resolve(host.projectPath, p), 'image')
          images.push(attachment)
          copied.push(attachment.id)
        }
      } catch (err) {
        for (const id of copied) {
          host.attachments.remove(id)
        }
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: message }], isError: true }
      }

      const caption = args.caption?.trim()
      const itemId = newId()
      host.emit({
        type: 'item.started',
        item: {
          id: itemId,
          turnId: host.turnId(),
          createdAt: Date.now(),
          kind: 'image_gallery',
          images,
          ...(caption ? { caption } : {}),
        },
      })
      host.emit({ type: 'item.completed', itemId })

      const names = images.map((img) => img.name).join(', ')
      return {
        content: [
          {
            type: 'text',
            text: `Sent ${images.length} image${images.length === 1 ? '' : 's'} to the chat: ${names}`,
          },
        ],
      }
    }
  )
}

export function createJettyMcpServer(host: MediaToolHost) {
  return createSdkMcpServer({
    name: 'jetty',
    version: '1.0.0',
    tools: [createSendImagesTool(host), createSendVideoTool(host)],
  })
}
