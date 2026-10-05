import type { ThreadRow } from '@/components/custom/thread_rows'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

import { markdownText } from '@/components/custom/markdown'
import { Tooltip, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

const minTurns = 2
const tickSpacing = 8
const fade = 24
// A gutter this wide holds the minimap without covering the conversation, so it stays visible.
const persistentGutter = 48
const stripLeft = 12
const stripMaxWidth = 40
const previewOffset = 32

type View = { current: number | null; first: number; last: number }

const emptyView: View = { current: null, first: -1, last: -1 }

// Row indices of the user's messages; stable while streaming only grows the last turn.
export function useTurns(rows: readonly ThreadRow[]) {
  const key = rows.flatMap((row, index) => (row.kind === 'user' ? [index] : [])).join()
  return useMemo(() => (key ? key.split(',').map(Number) : []), [key])
}

function compact(text: string | undefined) {
  return text?.replace(/\s+/g, ' ').trim() || undefined
}

function turnPreview(rows: readonly ThreadRow[], index: number) {
  const user = rows[index]
  let reply: string | undefined
  for (let next = index + 1; next < rows.length; next++) {
    const row = rows[next]!
    if (row.kind === 'user') break
    if (row.kind === 'assistant' && compact(row.item.text)) {
      reply = row.item.text
      break
    }
  }
  return {
    title: compact(user?.kind === 'user' ? user.item.text : undefined) ?? 'User message',
    reply: compact(reply),
  }
}

// The first turn whose message is on screen, else the last one scrolled past.
function viewOf(
  element: HTMLElement,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  turns: readonly number[]
): View {
  const top = element.scrollTop
  const bottom = top + element.clientHeight
  let first = -1
  let last = -1
  let preceding: number | null = null
  for (const [index, row] of turns.entries()) {
    const item = virtualizer.measurementsCache[row]
    if (!item) continue
    if (item.start < bottom && item.start + Math.max(1, item.size) > top) {
      if (first === -1) first = index
      last = index
    } else if (item.start <= top) preceding = index
  }
  return { current: first === -1 ? preceding : first, first, last }
}

// Moves the ticks, fading each end of the rail as far as ticks hide past it, up to `fade`.
function place(layer: HTMLElement, offset: number, height: number) {
  const length = (layer.childElementCount - 1) * tickSpacing
  const top = Math.min(fade, Math.max(0, -offset))
  const bottom = Math.min(fade, Math.max(0, offset + length - height))
  layer.style.transform = `translateY(${offset}px)`
  // Set on the clip itself: mask-image isn't inherited, so only it repaints.
  layer.parentElement!.style.maskImage =
    top || bottom
      ? `linear-gradient(to bottom, transparent, black ${top}px, black calc(100% - ${bottom}px), transparent)`
      : ''
}

export const ThreadMinimap = memo(function ThreadMinimap({
  turns,
  rows,
  scroller,
  virtualizer,
  gutter,
  onSelect,
}: {
  turns: readonly number[]
  rows: RefObject<readonly ThreadRow[]>
  scroller: RefObject<HTMLElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  gutter: number
  onSelect: (row: number) => void
}) {
  const [view, setView] = useState(emptyView)
  const [active, setActive] = useState<number | null>(null)
  const rail = useRef<HTMLButtonElement>(null)
  const ticks = useRef<HTMLSpanElement>(null)
  const enough = turns.length >= minTurns

  useEffect(() => {
    const element = scroller.current
    const box = rail.current
    const layer = ticks.current
    if (!element || !box || !layer || !enough) return
    const length = (turns.length - 1) * tickSpacing
    const update = () => {
      const next = viewOf(element, virtualizer, turns)
      setView((view) =>
        view.current === next.current && view.first === next.first && view.last === next.last
          ? view
          : next
      )
      // Like an editor's minimap, ticks taller than the rail scroll through it with the
      // conversation, clamped so uneven turns can't push the on-screen ticks out of the rail.
      const height = box.clientHeight
      const range = element.scrollHeight - element.clientHeight
      const offset = (range > 0 ? element.scrollTop / range : 0) * (height - length)
      place(
        layer,
        next.first === -1
          ? offset
          : Math.max(-next.first * tickSpacing, Math.min(offset, height - next.last * tickSpacing)),
        height
      )
    }
    // Fires once on observe too, which places the ticks to begin with.
    const resize = new ResizeObserver(update)
    resize.observe(box)
    element.addEventListener('scroll', update, { passive: true })
    return () => {
      resize.disconnect()
      element.removeEventListener('scroll', update)
    }
  }, [scroller, virtualizer, turns, enough])

  const activeIndex = active !== null && active < turns.length ? active : null
  const tick = activeIndex === null ? undefined : ticks.current?.children[activeIndex]
  const anchor = useMemo(
    () =>
      tick && {
        // Tracking the tick keeps the preview beside it while the ticks scroll.
        contextElement: tick,
        getBoundingClientRect: () => {
          const { left, top, height } = tick.getBoundingClientRect()
          return DOMRect.fromRect({ x: left, y: top + height / 2, width: previewOffset, height: 0 })
        },
      },
    [tick]
  )

  if (!enough) return null

  const persistent = gutter >= persistentGutter
  const stripWidth = Math.max(0, Math.min(stripMaxWidth, Math.floor(gutter) - stripLeft))
  const preview = activeIndex === null ? null : turnPreview(rows.current, turns[activeIndex]!)
  const current = view.current !== null && view.current < turns.length ? view.current : null
  const lastIndex = turns.length - 1

  function select(index: number | null) {
    const row = index === null ? undefined : turns[index]
    if (row !== undefined) onSelect(row)
  }

  function indexAt(event: PointerEvent<HTMLElement>) {
    const index = Math.round(
      (event.clientY - ticks.current!.getBoundingClientRect().top) / tickSpacing
    )
    return Math.max(0, Math.min(lastIndex, index))
  }

  // Scrolls the ticks just far enough to show this one clear of the fades, without moving
  // the first or last tick off its end; the next conversation scroll takes over.
  function reveal(index: number) {
    const box = rail.current!
    const layer = ticks.current!
    const height = box.clientHeight
    const top = index * tickSpacing
    const shift = layer.getBoundingClientRect().top - box.getBoundingClientRect().top
    const offset = Math.max(fade - top, Math.min(height - fade - top, shift))
    place(layer, Math.min(0, Math.max(height - lastIndex * tickSpacing, offset)), height)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const move: Record<string, (index: number) => number> = {
      ArrowDown: (index) => Math.min(lastIndex, index + 1),
      ArrowUp: (index) => Math.max(0, index - 1),
      Home: () => 0,
      End: () => lastIndex,
    }
    if (event.key in move) {
      event.preventDefault()
      const index = move[event.key]!(activeIndex ?? 0)
      setActive(index)
      reveal(index)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(activeIndex)
    }
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 z-40 hidden w-18 [@media(pointer:fine)]:block',
        !persistent &&
          'opacity-0 transition-opacity duration-150 focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none'
      )}
      data-persistent-gutter={persistent}
    >
      <div
        className={cn(
          'absolute top-1/2 left-3 -translate-y-1/2 select-none',
          // Capped to the gutter so it never covers the conversation; with no gutter it goes inert.
          stripWidth > 0 ? 'pointer-events-auto' : 'pointer-events-none'
        )}
        style={{
          height: `min(${Math.max(1, lastIndex * tickSpacing)}px, calc(100% - 10rem))`,
          width: stripWidth,
        }}
      >
        <button
          ref={rail}
          type='button'
          aria-label={`Jump to message: ${preview?.title ?? 'User message'}`}
          className='absolute inset-y-0 left-0 w-full cursor-pointer bg-transparent focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none'
          onPointerMove={(event) => setActive(indexAt(event))}
          onPointerLeave={() => setActive(null)}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            // Keeps focus where it was, so a pointer jump shows no focus ring.
            event.preventDefault()
            select(indexAt(event))
          }}
          // The rail overlays the conversation rather than sitting inside it, so it passes wheels on.
          onWheel={(event) => scroller.current?.scrollBy({ top: event.deltaY })}
          onFocus={() => setActive((index) => index ?? current ?? 0)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <span className='absolute top-0 left-3 h-full w-px bg-border/15' />
          {/* Clips ticks to the rail, keeping the half of an end tick that overhangs it. */}
          <span className='pointer-events-none absolute inset-x-0 -inset-y-px overflow-y-clip'>
            <span ref={ticks} className='absolute inset-x-0 inset-y-px'>
              {turns.map((row, index) => {
                const distance = activeIndex === null ? null : Math.abs(index - activeIndex)
                return (
                  <span
                    key={row}
                    aria-hidden='true'
                    data-in-view={(index >= view.first && index <= view.last) || undefined}
                    className={cn(
                      'absolute left-0 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition-[width,background-color] duration-150 data-in-view:bg-foreground/90 motion-reduce:transition-none',
                      distance === 0
                        ? 'w-9 bg-muted-foreground/75'
                        : distance === 1
                          ? 'w-6'
                          : distance === 2
                            ? 'w-3.75'
                            : 'w-3'
                    )}
                    style={{ top: index * tickSpacing }}
                  />
                )
              })}
            </span>
          </span>
        </button>
      </div>
      <Tooltip open={preview !== null}>
        <TooltipContent
          anchor={anchor}
          side='right'
          sideOffset={0}
          align={activeIndex === 0 ? 'start' : activeIndex === lastIndex ? 'end' : 'center'}
          className='pointer-events-none block w-80 max-w-80 rounded-lg px-2.5 py-2 text-sm leading-snug'
        >
          <p className='truncate font-medium'>{preview?.title}</p>
          {preview?.reply && (
            <p className='mt-0.5 line-clamp-3 text-muted-foreground'>
              {markdownText(preview.reply)}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  )
})
