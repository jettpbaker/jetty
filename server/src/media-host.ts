import type { ThreadEvent } from '@jetty/shared/events'
import type { Attachment } from '@jetty/shared/items'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { newId } from '@jetty/shared/wire'
import { Effect, Fiber, Path, Scope } from 'effect'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import type { Attachments, PersistKind } from './attachments'

import { StoreError } from './store'

export type MediaToolHost = {
  attachments: Attachments
  resolveAttachment: (id: string, kind: PersistKind) => Effect.Effect<Attachment, Error>
  projectPath: string
  containerPaths?: { checkout: string; artifacts: string }
  turnId: () => string
  emit: (
    event: ThreadEvent,
    turnId: string,
    onCommit: Effect.Effect<void>
  ) => Effect.Effect<void, Error>
}

type MediaItem =
  | { kind: 'image_gallery'; images: Attachment[] }
  | { kind: 'video'; video: Attachment }

type MediaRequest = {
  kind: PersistKind
  paths: readonly string[]
  attachmentIds?: readonly string[]
  caption: string | undefined
  toItem: (media: Attachment[]) => MediaItem
  summary: (media: Attachment[]) => string
}

export function createMediaSender(host: MediaToolHost) {
  return Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const path = yield* Path.Path

    function send(request: MediaRequest) {
      return Effect.scoped(
        Effect.gen(function* () {
          const turnId = host.turnId()
          const media: Attachment[] = []
          const count = request.paths.length + (request.attachmentIds?.length ?? 0)
          if (count < 1 || count > (request.kind === 'image' ? 4 : 1))
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                'Provide 1–4 images or one video, using paths or attachment ids'
              )
            )
          for (const id of request.attachmentIds ?? []) {
            media.push(yield* host.resolveAttachment(id, request.kind))
          }
          let committed = false
          for (const src of request.paths) {
            let source = path.resolve(host.projectPath, src)
            if (host.containerPaths) {
              const root =
                src === '/artifacts' || src.startsWith('/artifacts/')
                  ? host.containerPaths.artifacts
                  : host.containerPaths.checkout
              const suffix =
                src === '/workspace' || src === '/artifacts'
                  ? ''
                  : src.startsWith('/workspace/')
                    ? src.slice('/workspace/'.length)
                    : src.startsWith('/artifacts/')
                      ? src.slice('/artifacts/'.length)
                      : src
              if (isAbsolute(suffix))
                return yield* Effect.fail(
                  new StoreError('invalid_params', 'Media path is outside the environment')
                )
              source = resolve(root, suffix)
              const real = yield* Effect.tryPromise({
                try: () => realpath(source),
                catch: () => new StoreError('invalid_params', 'Media file not found'),
              })
              const rel = relative(root, real)
              if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
                return yield* Effect.fail(
                  new StoreError('invalid_params', 'Media path is outside the environment')
                )
              source = real
            }
            media.push(
              yield* Effect.acquireRelease(
                host.attachments.persistFile(source, request.kind),
                (attachment) => (committed ? Effect.void : host.attachments.remove(attachment.id)),
                { interruptible: true }
              )
            )
          }
          if (host.turnId() !== turnId)
            return yield* Effect.fail(new StoreError('invalid_params', 'Turn is no longer active'))

          const caption = request.caption?.trim()
          const itemId = newId()
          yield* host.emit(
            {
              type: 'item.started',
              item: {
                id: itemId,
                turnId,
                createdAt: Date.now(),
                ...request.toItem(media),
                ...(caption ? { caption } : {}),
              },
            },
            turnId,
            Effect.sync(() => {
              committed = true
            })
          )
          yield* host.emit({ type: 'item.completed', itemId }, turnId, Effect.void)
          return { content: [{ type: 'text' as const, text: request.summary(media) }] }
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
      )
    }

    return function run(request: MediaRequest, extra: unknown): Promise<CallToolResult> {
      const signal =
        extra &&
        typeof extra === 'object' &&
        'signal' in extra &&
        extra.signal instanceof AbortSignal
          ? extra.signal
          : undefined
      return Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkIn(send(request), scope)
          return yield* Fiber.join(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber)))
        }),
        { signal }
      )
    }
  })
}
