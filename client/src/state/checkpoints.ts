import type { Attachment } from '@jetty/shared/items'

import { mediaUrl } from '@/components/custom/media_layout'
import { isImageType, type ReadyImage } from '@/hooks/use-image-attachments'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { MAX_IMAGES_PER_TURN, MAX_TURN_IMAGE_BYTES } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { Atom } from 'effect/unstable/reactivity'
import { useContext } from 'react'
import { toast } from 'sonner'

import { run } from './connection'
import { useDraft } from './drafts'

const rewindingAtom = Atom.family((_threadId: string) => Atom.make(false).pipe(Atom.keepAlive))

export function useIsRewinding(threadId: string) {
  return useAtomValue(rewindingAtom(threadId))
}

async function restoreImages(attachments: readonly Attachment[]): Promise<ReadyImage[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (!isImageType(attachment.mimeType))
        throw new Error(`Cannot restore ${attachment.name} to the composer`)
      const response = await fetch(mediaUrl(attachment))
      if (!response.ok) throw new Error(`Cannot read ${attachment.name}`)
      const blob = await response.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      return { ...attachment, mimeType: attachment.mimeType, url: dataUrl, dataUrl }
    })
  )
}

export function useRewindThread(threadId: string) {
  const registry = useContext(RegistryContext)
  const { read, update } = useDraft(threadId)
  const pending = useIsRewinding(threadId)
  const setPending = (value: boolean) => registry.set(rewindingAtom(threadId), value)

  function rewind(
    messageId: string,
    attachments: readonly Attachment[],
    restoreFiles: boolean,
    done: () => void
  ) {
    if (registry.get(rewindingAtom(threadId))) return
    setPending(true)
    run(registry, (connection) =>
      Effect.gen(function* () {
        const images = yield* Effect.tryPromise(() => restoreImages(attachments))
        const current = read()
        if (current.images.some((image) => !image.dataUrl))
          return yield* Effect.fail(
            new Error('Wait for images to finish preparing before rewinding.')
          )
        const combined = [...images, ...current.images]
        if (
          combined.length > MAX_IMAGES_PER_TURN ||
          combined.reduce((sum, image) => sum + image.sizeBytes, 0) > MAX_TURN_IMAGE_BYTES
        )
          return yield* Effect.fail(
            new Error('Make room for this message’s images in the composer before rewinding.')
          )
        const restored = yield* connection.request('thread.rewind', {
          threadId,
          messageId,
          restoreFiles,
        })
        const draft = read()
        update({
          text: [restored.text, draft.text].filter(Boolean).join('\n\n'),
          images: [...images, ...draft.images],
          editing: undefined,
          typedFor: undefined,
          pendingId: undefined,
          parked: undefined,
          questions: undefined,
        })
        done()
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => toast.error(error instanceof Error ? error.message : String(error)))
        ),
        Effect.ensuring(Effect.sync(() => setPending(false)))
      )
    )
  }
  return { pending, rewind }
}
