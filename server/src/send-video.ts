import { tool } from '@anthropic-ai/claude-agent-sdk'
import { newId } from '@jetty/shared/wire'
import { Effect, Path } from 'effect'
import { z } from 'zod'

import type { MediaToolHost } from './media-host'

import { createMediaToolRunner } from './media-host'
import { StoreError } from './store'

export const SEND_VIDEO_TOOL = 'mcp__jetty__send_video'

const SEND_VIDEO_DESCRIPTION =
  "Show the user a video in the chat (for example, a screen recording verifying a UI flow). One video per call; the path may be absolute or relative to the project root. Supported formats: mp4, webm. The video is copied into jetty's store, so temporary files may be deleted afterwards."

export function createSendVideoTool(host: MediaToolHost) {
  return Effect.gen(function* () {
    const path = yield* Path.Path
    const run = yield* createMediaToolRunner
    return tool(
      'send_video',
      SEND_VIDEO_DESCRIPTION,
      {
        path: z
          .string()
          .describe('Absolute path or path relative to the project root (one mp4 or webm file)'),
        caption: z.string().optional().describe('Optional caption shown with the video'),
      },
      (args, extra) =>
        run(
          Effect.scoped(
            Effect.gen(function* () {
              const turnId = host.turnId()
              let committed = false
              const video = yield* Effect.acquireRelease(
                host.attachments.persistFile(path.resolve(host.projectPath, args.path), 'video'),
                (attachment) => (committed ? Effect.void : host.attachments.remove(attachment.id)),
                { interruptible: true }
              )
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
                    kind: 'video',
                    video,
                    ...(caption ? { caption } : {}),
                  },
                },
                turnId,
                Effect.sync(() => {
                  committed = true
                })
              )
              yield* host.emit({ type: 'item.completed', itemId }, turnId, Effect.void)

              return {
                content: [{ type: 'text' as const, text: `Sent video to the chat: ${video.name}` }],
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
