import type { ThreadItem } from '@jetty/shared/items'

import { socket, tabsStore, timelineStore } from '@/app-state'
import { ApprovalDock } from '@/components/approval-dock'
import { Composer, focusComposerTextarea, insertComposerChar } from '@/components/composer'
import { QuestionDock } from '@/components/question-dock'
import { Timeline } from '@/components/timeline'
import { cn } from '@/lib/utils'
import { pendingSends } from '@/state/pending'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useSyncExternalStore } from 'react'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable=true]') !== null
  )
}

function pendingApproval(
  items: ThreadItem[]
): Extract<ThreadItem, { kind: 'approval' }> | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!
    if (item.kind === 'approval' && item.decision === undefined) return item
  }
  return undefined
}

function pendingQuestion(
  items: ThreadItem[]
): Extract<ThreadItem, { kind: 'question' }> | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!
    if (item.kind === 'question' && item.answers === undefined && !item.skipped) return item
  }
  return undefined
}

export const Route = createFileRoute('/thread/$threadId')({
  component: ThreadPage,
})

function ThreadPage() {
  const { threadId } = Route.useParams()

  // A pending send at first sight of a thread means we arrived from a draft
  // submit — only that arrival gets the soft entrance; switching threads stays
  // instant.
  const arriveRef = useRef<{ threadId: string; arrive: boolean } | null>(null)
  if (arriveRef.current?.threadId !== threadId) {
    arriveRef.current = { threadId, arrive: pendingSends.get(threadId) !== undefined }
  }

  useEffect(() => {
    tabsStore.open(threadId)
    timelineStore.openThread(threadId)
    return () => {
      timelineStore.closeThread(threadId)
    }
  }, [threadId])

  // Type-to-focus: plain printable keys while the thread is open land in the
  // composer (when present). Approval/question docks replace the composer, so
  // the query finds nothing and we no-op.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.length !== 1) return
      if (isEditableTarget(event.target)) return

      const textarea = focusComposerTextarea()
      if (!textarea) return

      const before = textarea.value
      const start = textarea.selectionStart
      // If the browser dropped the key (focus didn't capture it), insert it
      // ourselves. A task boundary — not a microtask — so the check runs after
      // the default insertion has definitely happened or definitely won't.
      setTimeout(() => {
        if (textarea.value !== before) return
        if (document.activeElement !== textarea) return
        if (textarea.selectionStart !== start) return
        insertComposerChar(textarea, event.key)
      })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const state = useSyncExternalStore(timelineStore.subscribe, () =>
    timelineStore.getSnapshot(threadId)
  )

  const awaiting = state.status === 'awaiting_approval'
  const approval = awaiting ? pendingApproval(state.items) : undefined
  const question = awaiting && !approval ? pendingQuestion(state.items) : undefined

  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-1 flex-col',
        arriveRef.current.arrive && 'page-arrive'
      )}
    >
      <Timeline
        threadId={threadId}
        items={state.items}
        status={state.status}
        activeTurnId={state.activeTurnId}
        overlayInset
      />
      {/* floats over the scrolling timeline so the frosted composer has content
          to blur; pointer-events split keeps the gutter click-through */}
      <div className='pointer-events-none absolute inset-x-0 bottom-0 z-10'>
        <div className='pointer-events-auto mx-auto w-full max-w-3xl p-4'>
          {approval ? (
            <ApprovalDock
              item={approval}
              respond={(decision, message) =>
                socket.request('approval.respond', {
                  threadId,
                  itemId: approval.id,
                  decision,
                  message,
                })
              }
            />
          ) : question ? (
            <QuestionDock
              key={question.id}
              item={question}
              respond={(answers) =>
                socket.request('question.respond', { threadId, itemId: question.id, answers })
              }
            />
          ) : (
            <Composer threadId={threadId} status={state.status} />
          )}
        </div>
      </div>
    </div>
  )
}
