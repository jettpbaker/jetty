import type { Reply } from '@jetty/shared/items'

import { KeybindChip, keybinds } from '@/components/custom/keybinds'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// The pill's gap from the selected line, and the room it keeps from the window's edges.
const lift = 6
const edge = 8

type Spot = { reply: Reply; x: number; top: number; bottom: number }

function messageOf(node: Node) {
  return (node instanceof Element ? node : node.parentElement)?.closest('[data-quote]')
}

// The selection, when its text lies inside one agent message: an element with data-quote, its
// item id. A triple-clicked last paragraph runs on to the start of the next row, so the range
// may leave the message as long as nothing past it is selected.
function selectedReply(chat: HTMLElement) {
  const selection = document.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  const message = messageOf(range.startContainer) ?? messageOf(range.endContainer)
  const itemId = message?.getAttribute('data-quote')
  const text = selection.toString().trim()
  if (!message || !itemId || !chat.contains(message) || !text) return
  const inside = range.cloneRange()
  if (!message.contains(range.startContainer)) inside.setStart(message, 0)
  if (!message.contains(range.endContainer)) inside.setEnd(message, message.childNodes.length)
  if (inside.toString().trim() !== text) return
  return { selection, range, inside, reply: { itemId, text } }
}

// Where the selection ends, as the pointer or Shift+arrows left it, even selecting backwards.
function spotOf(chat: HTMLElement): Spot | undefined {
  const selected = selectedReply(chat)
  if (!selected) return
  const { selection, range, inside, reply } = selected
  const backward =
    range.startContainer === selection.focusNode && range.startOffset === selection.focusOffset
  const rects = [...inside.getClientRects()].filter((rect) => rect.width > 0)
  const rect = backward ? rects[0] : rects.at(-1)
  if (!rect) return
  return { reply, x: backward ? rect.left : rect.right, top: rect.top, bottom: rect.bottom }
}

// Quotes text selected in an agent's reply into the next message: a pill over the selection's
// end, or ⌘L. It waits for the pointer to let go, so a drag never drags it along.
export function AddToPrompt({
  chatRef,
  onAdd,
}: {
  chatRef: RefObject<HTMLElement | null>
  onAdd: (reply: Reply) => void
}) {
  const [spot, setSpot] = useState<Spot>()
  const pillRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const chat = chatRef.current
    if (!chat) return
    let pressed = false
    const show = () => setSpot(pressed ? undefined : spotOf(chat))
    const hide = () => setSpot(undefined)
    const press = () => {
      pressed = true
      hide()
    }
    const release = () => {
      pressed = false
      show()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('selectionchange', show)
    document.addEventListener('pointerdown', press)
    document.addEventListener('keydown', escape)
    window.addEventListener('pointerup', release)
    window.addEventListener('resize', hide)
    chat.addEventListener('scroll', hide, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', show)
      document.removeEventListener('pointerdown', press)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('resize', hide)
      chat.removeEventListener('scroll', hide)
    }
  }, [chatRef])

  useLayoutEffect(() => {
    const pill = pillRef.current
    if (!pill || !spot) return
    const { width, height } = pill.getBoundingClientRect()
    const above = spot.top - lift - height
    pill.style.left = `${Math.min(Math.max(spot.x - width / 2, edge), innerWidth - width - edge)}px`
    pill.style.top = `${above >= edge ? above : spot.bottom + lift}px`
  }, [spot])

  function add(reply: Reply) {
    setSpot(undefined)
    onAdd(reply)
  }

  useHotkey(
    keybinds.addToPrompt.hotkey,
    (event) => {
      const selected = chatRef.current && selectedReply(chatRef.current)
      if (!selected) return
      event.preventDefault()
      add(selected.reply)
    },
    { preventDefault: false, stopPropagation: false }
  )

  if (!spot) return null
  const press = pressProps(() => add(spot.reply))
  return createPortal(
    <div
      ref={pillRef}
      className='fixed top-0 left-0 z-50 flex origin-bottom animate-(--motion-popup-enter) rounded-md bg-popover p-0.5 text-popover-foreground shadow-md ring-1 ring-border motion-reduce:animate-none'
    >
      <Button
        variant='ghost'
        size='xs'
        className='gap-1.5 rounded-sm pr-1'
        {...press}
        // Acts on press. The pill unmounts under the pointer, and the mouse events that would
        // follow would land on the chat, take focus from the composer and drop the selection.
        onPointerDown={(event) => {
          event.preventDefault()
          press.onPointerDown(event)
        }}
      >
        Add to prompt
        <KeybindChip binding={keybinds.addToPrompt} />
      </Button>
    </div>,
    document.body
  )
}
