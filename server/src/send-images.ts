import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { MAX_GALLERY_IMAGES } from '@jetty/shared/items'
import { Effect } from 'effect'
import { z } from 'zod'

import { createMediaSender, type MediaToolHost } from './media-host'
import { createSendVideoTool } from './send-video'

export const SEND_IMAGES_TOOL = 'mcp__jetty__send_images'

const SEND_IMAGES_DESCRIPTION =
  "Show the user screenshots or other images in the chat (for example, to verify UI changes). Paths may be absolute or relative to the project root. Up to 4 images render as a gallery. Supported formats: png, jpg, gif, webp. Images are copied into jetty's store, so temporary files may be deleted afterwards."

export function createSendImagesTool(host: MediaToolHost) {
  return Effect.gen(function* () {
    const send = yield* createMediaSender(host)
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
      (args, extra) =>
        send(
          {
            kind: 'image',
            paths: args.paths,
            caption: args.caption,
            toItem: (images) => ({ kind: 'image_gallery', images }),
            summary: (images) =>
              `Sent ${images.length} image${images.length === 1 ? '' : 's'} to the chat: ${images.map((image) => image.name).join(', ')}`,
          },
          extra
        )
    )
  })
}

export function createJettyMcpServer(host: MediaToolHost) {
  return Effect.gen(function* () {
    const images = yield* createSendImagesTool(host)
    const video = yield* createSendVideoTool(host)
    return createSdkMcpServer({ name: 'jetty', version: '1.0.0', tools: [images, video] })
  })
}
