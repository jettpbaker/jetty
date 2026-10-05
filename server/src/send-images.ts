import { MAX_GALLERY_IMAGES } from '@jetty/shared/items'
import { MAX_IMAGE_BYTES } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { z } from 'zod'

import { createMediaSender, type MediaToolHost } from './media-host'

export const SEND_IMAGES_TOOL = 'mcp__jetty__send_images'

const SEND_IMAGES_DESCRIPTION = `Show the user screenshots or other images in the chat, for example to verify UI changes. Up to 4 render as a gallery; png, jpg, gif or webp, up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB each. To re-post images already in this project's threads, pass their attachment ids. Jetty keeps its own copy, so temporary files can be deleted afterwards.`

export function createSendImagesTool(host: MediaToolHost) {
  return Effect.gen(function* () {
    const send = yield* createMediaSender(host)
    return {
      name: 'send_images',
      description: SEND_IMAGES_DESCRIPTION,
      inputSchema: {
        paths: z
          .array(z.string())
          .min(1)
          .max(MAX_GALLERY_IMAGES)
          .optional()
          .describe('Absolute paths or paths relative to the project root (1–4 image files)'),
        attachmentIds: z
          .array(z.string())
          .min(1)
          .max(MAX_GALLERY_IMAGES)
          .optional()
          .describe("Ids of images already posted in this project's threads"),
        caption: z.string().optional().describe('Optional caption shown with the gallery'),
      },
      handler: (
        args: { paths?: string[]; attachmentIds?: string[]; caption?: string },
        extra: unknown
      ) =>
        send(
          {
            kind: 'image',
            paths: args.paths ?? [],
            attachmentIds: args.attachmentIds,
            caption: args.caption,
            toItem: (images) => ({ kind: 'image_gallery', images }),
            summary: (images) =>
              `Sent ${images.length} image${images.length === 1 ? '' : 's'} to the chat: ${images.map((image) => `${image.name} (attachment id ${image.id})`).join(', ')}`,
          },
          extra
        ),
    }
  })
}
