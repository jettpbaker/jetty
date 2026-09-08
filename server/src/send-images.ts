import type { Attachment } from '@jetty/shared/items'

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { MAX_GALLERY_IMAGES } from '@jetty/shared/items'
import { newId } from '@jetty/shared/wire'
import { Effect, Path } from 'effect'
import { z } from 'zod'

import type { MediaToolHost } from './media-host'

import { createMediaToolRunner } from './media-host'
import { createSendVideoTool } from './send-video'
import { StoreError } from './store'

export const SEND_IMAGES_TOOL = 'mcp__jetty__send_images'
export type { MediaToolHost }

const SEND_IMAGES_DESCRIPTION =
  "Show the user screenshots or other images in the chat (for example, to verify UI changes). Paths may be absolute or relative to the project root. Up to 4 images render as a gallery. Supported formats: png, jpg, gif, webp. Images are copied into jetty's store, so temporary files may be deleted afterwards."

export function createSendImagesTool(host: MediaToolHost) {
  return Effect.gen(function* () {
    const path = yield* Path.Path
    const run = yield* createMediaToolRunner
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
        run(
          Effect.scoped(
            Effect.gen(function* () {
              const turnId = host.turnId()
              const images: Attachment[] = []
              let committed = false
              for (const p of args.paths) {
                const attachment = yield* Effect.acquireRelease(
                  host.attachments.persistFile(path.resolve(host.projectPath, p), 'image'),
                  (attachment) =>
                    committed ? Effect.void : host.attachments.remove(attachment.id),
                  { interruptible: true }
                )
                images.push(attachment)
              }
              if (host.turnId() !== turnId)
                return yield* Effect.fail(
                  new StoreError('invalid_params', 'Turn is no longer active')
                )

              const caption = args.caption?.trim()
              const itemId = newId()
              yield* host.emit(
                {
                  type: 'item.started',
                  item: {
                    id: itemId,
                    turnId,
                    createdAt: Date.now(),
                    kind: 'image_gallery',
                    images,
                    ...(caption ? { caption } : {}),
                  },
                },
                turnId,
                Effect.sync(() => {
                  committed = true
                })
              )
              yield* host.emit({ type: 'item.completed', itemId }, turnId, Effect.void)

              const names = images.map((img) => img.name).join(', ')
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Sent ${images.length} image${images.length === 1 ? '' : 's'} to the chat: ${names}`,
                  },
                ],
              }
            })
          ).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                content: [
                  {
                    type: 'text' as const,
                    text: error instanceof Error ? error.message : String(error),
                  },
                ],
                isError: true,
              })
            )
          ),
          extra
        )
    )
  })
}

export function createJettyMcpServer(host: MediaToolHost) {
  return Effect.gen(function* () {
    const images = yield* createSendImagesTool(host)
    const video = yield* createSendVideoTool(host)
    return createSdkMcpServer({
      name: 'jetty',
      version: '1.0.0',
      tools: [images, video],
    })
  })
}
