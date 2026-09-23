import { tool } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'
import { z } from 'zod'

import { createMediaSender, type MediaToolHost } from './media-host'

export const SEND_VIDEO_TOOL = 'mcp__jetty__send_video'

const SEND_VIDEO_DESCRIPTION =
  "Show the user a video in the chat (for example, a screen recording verifying a UI flow). One video per call; the path may be absolute or relative to the project root. Supported formats: mp4, webm. The video is copied into jetty's store, so temporary files may be deleted afterwards."

export function createSendVideoTool(host: MediaToolHost) {
  return Effect.gen(function* () {
    const send = yield* createMediaSender(host)
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
        send(
          {
            kind: 'video',
            paths: [args.path],
            caption: args.caption,
            toItem: ([video]) => ({ kind: 'video', video: video! }),
            summary: ([video]) => `Sent video to the chat: ${video!.name}`,
          },
          extra
        )
    )
  })
}
