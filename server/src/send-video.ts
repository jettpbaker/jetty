import { tool } from '@anthropic-ai/claude-agent-sdk'
import { newId } from '@jetty/shared/wire'
import { resolve } from 'node:path'
import { z } from 'zod'

import type { MediaToolHost } from './media-host'

export const SEND_VIDEO_TOOL = 'mcp__jetty__send_video'

const SEND_VIDEO_DESCRIPTION =
  "Show the user a video in the chat (for example, a screen recording verifying a UI flow). One video per call; the path may be absolute or relative to the project root. Supported formats: mp4, webm. The video is copied into jetty's store, so temporary files may be deleted afterwards."

export function createSendVideoTool(host: MediaToolHost) {
  return tool(
    'send_video',
    SEND_VIDEO_DESCRIPTION,
    {
      path: z
        .string()
        .describe('Absolute path or path relative to the project root (one mp4 or webm file)'),
      caption: z.string().optional().describe('Optional caption shown with the video'),
    },
    async (args) => {
      const turnId = host.turnId()
      let video
      try {
        video = host.attachments.persistFile(resolve(host.projectPath, args.path), 'video')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: message }], isError: true }
      }

      const caption = args.caption?.trim()
      const itemId = newId()
      await host.emit(
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
        turnId
      )
      await host.emit({ type: 'item.completed', itemId }, turnId)

      return {
        content: [{ type: 'text', text: `Sent video to the chat: ${video.name}` }],
      }
    }
  )
}
