import { Effect } from 'effect'
import { z } from 'zod'

import { createMediaSender, type MediaToolHost } from './media-host'

export const SEND_VIDEO_TOOL = 'mcp__jetty__send_video'

const SEND_VIDEO_DESCRIPTION =
  "Show the user a video in the chat (for example, a screen recording verifying a UI flow). Re-post an existing video without uploading using attachmentId visible in your project. One video per call; the path may be absolute or relative to the project root. Supported formats: mp4, webm. The video is copied into jetty's store, so temporary files may be deleted afterwards."

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
          .describe('Existing jetty video attachment id visible in your project'),
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
            summary: ([video]) => `Sent video to the chat: ${video!.name}`,
          },
          extra
        ),
    }
  })
}
