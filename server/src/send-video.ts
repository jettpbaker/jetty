import { MAX_VIDEO_BYTES } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { z } from 'zod'

import { createMediaSender, type MediaToolHost } from './media-host'

export const SEND_VIDEO_TOOL = 'mcp__jetty__send_video'

const SEND_VIDEO_DESCRIPTION = `Show the user one video in the chat, for example a screen recording of a UI flow: mp4 or webm, up to ${MAX_VIDEO_BYTES / 1024 / 1024} MB. To re-post a video already in this project's threads, pass its attachment id. Jetty keeps its own copy, so temporary files can be deleted afterwards.`

export function createSendVideoTool(host: MediaToolHost) {
  return Effect.gen(function* () {
    const send = yield* createMediaSender(host)
    return {
      name: 'send_video',
      description: SEND_VIDEO_DESCRIPTION,
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Absolute path or path relative to the project root (one mp4 or webm file)'),
        attachmentId: z
          .string()
          .optional()
          .describe("Id of a video already posted in this project's threads"),
        caption: z.string().optional().describe('Optional caption shown with the video'),
      },
      handler: (args: { path?: string; attachmentId?: string; caption?: string }, extra: unknown) =>
        send(
          {
            kind: 'video',
            paths: args.path ? [args.path] : [],
            attachmentIds: args.attachmentId ? [args.attachmentId] : [],
            caption: args.caption,
            toItem: ([video]) => ({ kind: 'video', video: video! }),
            summary: ([video]) =>
              `Sent video to the chat: ${video!.name} (attachment id ${video!.id})`,
          },
          extra
        ),
    }
  })
}
