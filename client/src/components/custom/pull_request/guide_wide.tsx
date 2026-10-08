import type { PullRequestGuide } from '@jetty/shared/wire'

import { cn } from '@/lib/utils'
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

import type { PrFile } from './adapter'

import { basename, FileGlyph } from '../diff/file_name'
import { byTreeOrder } from '../diff/model'
import { guideSections, partKey, type GuidePart, type GuideSection as Section } from './guide'

// The rail's top line: chapter text sticks there, a jump puts a row's top there, and the row across it
// is current. The rows' top margin sets it, not the pane's padding, which would hold the cards'
// sticky headers that far down too.
const edge = 28
const tickSpacing = 8
// The wide layout's breakpoint, as the rows' container queries have it: the rail and ~600px of diff.
const wideFrom = 1000

function numberOf(number: number) {
  return String(number).padStart(2, '0')
}

// The guide's words, with `code` set as inline code. A blank line starts a new paragraph.
function Prose({
  text,
  className,
  strong = false,
}: {
  text: string
  className?: string
  strong?: boolean
}) {
  return text.split(/\n\s*\n/).map((paragraph, index) => (
    <p
      key={index}
      className={cn(
        'max-w-[66ch] text-sm leading-6',
        strong ? 'text-foreground' : 'text-muted-foreground',
        className
      )}
    >
      {paragraph.split(/(`[^`]+`)/g).map((part, index) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code
            key={index}
            className='inline-code rounded px-1 py-px font-mono text-xs text-foreground wrap-anywhere'
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        )
      )}
    </p>
  ))
}

function RailHead({ section, total, note }: { section: Section; total: number; note?: ReactNode }) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        {section.number != null && (
          <p className='font-mono text-xs leading-3.5 text-muted-foreground tabular-nums'>
            {numberOf(section.number)} / {numberOf(total)}
          </p>
        )}
        <h2 className='text-base font-medium'>{section.title}</h2>
      </div>
      {section.why && <Prose text={section.why} className='text-pretty' />}
      {note}
    </div>
  )
}

function Minimap({
  sections,
  current,
  viewed,
  onSelect,
}: {
  sections: Section[]
  current: number
  viewed: boolean[]
  onSelect: (index: number) => void
}) {
  const [active, setActive] = useState<number | null>(null)
  const ticksRef = useRef<HTMLSpanElement>(null)
  const last = sections.length - 1
  const preview = active === null ? undefined : sections[active]

  // Each tick owns the full 8px row around it, so the button reaches half a row past either end.
  function indexAt(event: PointerEvent<HTMLElement>) {
    const index = Math.round(
      (event.clientY - ticksRef.current!.getBoundingClientRect().top) / tickSpacing
    )
    return Math.max(0, Math.min(last, index))
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const moves: Record<string, (index: number) => number> = {
      ArrowDown: (index) => Math.min(last, index + 1),
      ArrowUp: (index) => Math.max(0, index - 1),
      Home: () => 0,
      End: () => last,
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      setActive(move(active ?? current))
    } else if ((event.key === 'Enter' || event.key === ' ') && active !== null) {
      event.preventDefault()
      onSelect(active)
    }
  }

  return (
    <div
      className='absolute top-1/2 left-3 w-10 -translate-y-1/2 select-none'
      style={{ height: last * tickSpacing }}
    >
      <button
        type='button'
        aria-label={`Jump to chapter: ${(preview ?? sections[current])?.title}`}
        className='absolute -inset-y-1 -left-3 w-13 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/70'
        onPointerMove={(event) => setActive(indexAt(event))}
        onPointerLeave={() => setActive(null)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          // Keeps focus where it was, so a pointer jump shows no focus ring.
          event.preventDefault()
          onSelect(indexAt(event))
        }}
        onFocus={() => setActive((index) => index ?? current)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        <span ref={ticksRef} className='pointer-events-none absolute inset-y-1 right-0 left-3'>
          <span className='absolute inset-y-0 left-2 w-px bg-border/15' />
          {sections.map((section, index) => {
            const distance = active === null ? null : Math.abs(index - active)
            return (
              <span
                key={`${index}:${section.title}`}
                aria-hidden='true'
                className={cn(
                  'absolute left-0 h-0.5 -translate-y-1/2 rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none',
                  index === current
                    ? 'bg-foreground/90'
                    : distance === 0
                      ? 'bg-muted-foreground/75'
                      : viewed[index]
                        ? 'bg-muted-foreground/15'
                        : 'bg-muted-foreground/35',
                  distance === 0 ? 'w-6' : distance === 1 ? 'w-4' : distance === 2 ? 'w-2.5' : 'w-2'
                )}
                style={{ top: index * tickSpacing }}
              />
            )
          })}
        </span>
      </button>
      {preview && (
        <div
          className='pointer-events-none absolute left-10 z-10 flex w-85 -translate-y-1/2 flex-col gap-0.5 rounded-lg border border-border bg-popover px-2.5 py-2 text-sm'
          style={{ top: active! * tickSpacing }}
        >
          <p className='font-medium text-popover-foreground'>{preview.title}</p>
          {preview.why && <Prose text={preview.why} className='leading-5 text-pretty' />}
        </div>
      )}
    </div>
  )
}

// The summary's changed files, flat: down the first column, then the second, generated files last.
// Under 640px there's one column, so the longest names stay whole.
function FileList({ files, onSelect }: { files: PrFile[]; onSelect: (path: string) => void }) {
  const half = Math.ceil(files.length / 2)
  return (
    <div className='@container/files flex flex-col gap-2'>
      <p className='flex gap-1.5 text-xs text-muted-foreground'>
        <span className='font-medium'>Files</span>
        {files.length}
      </p>
      <div className='flex flex-col @min-[640px]/files:flex-row @min-[640px]/files:gap-10'>
        {[files.slice(0, half), files.slice(half)].map((column, index) => (
          <div key={index} className='flex min-w-0 flex-1 flex-col'>
            {column.map((file) => {
              const name = basename(file.path)
              const directory = file.path.slice(0, -name.length)
              return (
                <button
                  key={file.path}
                  type='button'
                  className='flex h-8 items-center gap-2 rounded-sm text-left font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                  onClick={() => onSelect(file.path)}
                >
                  <FileGlyph file={file} />
                  <span className='flex min-w-0 flex-1 items-center gap-2'>
                    <span className={cn('shrink-0', file.generated && 'text-muted-foreground')}>
                      {name}
                    </span>
                    {directory && (
                      <span className='min-w-0 truncate text-muted-foreground'>{directory}</span>
                    )}
                  </span>
                  <span className='flex shrink-0 gap-1.5 tabular-nums'>
                    {file.additions > 0 && (
                      <span className='text-status-success'>+{file.additions}</span>
                    )}
                    {file.deletions > 0 && (
                      <span className='text-status-error'>−{file.deletions}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// The Guide tab: one scroll of rows, the summary then each chapter. From 1000px wide (the rail and
// about 600px of diff), a row's header and why sit in a 400px rail beside its files, sticky at the
// rail's top line until the row's last card carries them off. Narrower, they head the row and scroll
// with it. The minimap in the left gutter stays put and jumps between rows either way.
export function GuideWide({
  files: changed,
  guide,
  hideGenerated,
  note,
  renderCard,
}: {
  files: PrFile[]
  guide: PullRequestGuide
  hideGenerated: boolean
  // Under the summary: what's happening to the guide, such as a newer one on its way.
  note?: ReactNode
  renderCard: (
    part: GuidePart,
    key: string,
    viewed: boolean,
    onViewed: (checked: boolean) => void
  ) => ReactNode
}) {
  const chapters = guideSections(changed, guide, hideGenerated)
  const total = chapters.filter((section) => section.number != null).length
  const sections: Section[] = [
    { number: 0, title: 'Summary', why: guide.summary, parts: [] },
    ...chapters,
  ]
  const files = [...changed]
    .filter((file) => !hideGenerated || !file.generated)
    .sort((a, b) => Number(a.generated) - Number(b.generated) || byTreeOrder(a, b))
  // Guide progress only: never the Diff tab's per-file Viewed, the review count or GitHub.
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set())
  const [scrolledTo, setScrolledTo] = useState(0)
  const current = Math.min(scrolledTo, sections.length - 1)
  const paneRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef<(HTMLElement | null)[]>([])
  const done = sections.map(
    (section, index) =>
      section.parts.length > 0 &&
      section.parts.every((part) => viewed.has(partKey(index, part.file.path)))
  )

  // What sits at the top line, so switching between the wide and narrow layouts keeps it there: the
  // card across the line, or the row while its first card still shows its top (narrow heads that card
  // with the row's title and why). The browser's own scroll anchoring gives up when the rows restyle.
  const anchorRef = useRef<{ element: Element; offset: number } | null>(null)
  const wideRef = useRef<boolean | null>(null)
  function anchorOf(pane: HTMLElement) {
    const top = pane.getBoundingClientRect().top
    const line = top + edge + 1
    let anchor: Element | null = null
    for (const row of sectionsRef.current) {
      if (!row || row.getBoundingClientRect().top > line) break
      anchor = row
      for (const [index, card] of row.querySelectorAll('.file-card').entries()) {
        const cardTop = card.getBoundingClientRect().top
        if (cardTop > line) break
        if (index > 0 || cardTop < top) anchor = card
      }
    }
    return anchor && { element: anchor, offset: anchor.getBoundingClientRect().top - top }
  }

  // The current row is the last to start above the rail's top line, the gap after it included; at
  // the bottom, the last row is current even if it can't reach the line.
  function sync() {
    const pane = paneRef.current!
    anchorRef.current = anchorOf(pane)
    const rows = sectionsRef.current.filter((element) => element !== null)
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1) {
      setScrolledTo(rows.length - 1)
      return
    }
    const line = pane.getBoundingClientRect().top + edge + 1
    let next = 0
    for (const [index, element] of rows.entries())
      if (element.getBoundingClientRect().top <= line) next = index
    setScrolledTo(next)
  }

  function scrollToLine(element: Element) {
    const pane = paneRef.current!
    pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - edge
  }

  // A file's first card, in the first chapter that shows it.
  function openFile(path: string) {
    for (const [index, section] of sections.entries()) {
      const at = section.parts.findIndex((part) => part.file.path === path)
      if (at === -1) continue
      scrollToLine(sectionsRef.current[index]!.querySelectorAll('.file-card')[at]!)
      return
    }
  }

  // Cards collapsing, a hidden section or a resize can move the rows without a scroll. Crossing the
  // breakpoint puts the anchor back where it was before painting.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const pane = paneRef.current!
      const wide = pane.getBoundingClientRect().width >= wideFrom
      const anchor = anchorRef.current
      if (anchor && wideRef.current !== null && wide !== wideRef.current)
        pane.scrollTop +=
          anchor.element.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          anchor.offset
      wideRef.current = wide
      sync()
    })
    observer.observe(rowsRef.current!)
    observer.observe(paneRef.current!)
    return () => observer.disconnect()
  }, [])

  return (
    <div className='@container/guide relative min-h-0 flex-1'>
      <div
        ref={paneRef}
        aria-label='Guide'
        onScroll={sync}
        className='scrollbar-subtle h-full overflow-y-auto pb-7'
      >
        {/* The gap sits between rows, so a row ends at its last card and its rail text, stuck inside
            the row, is pushed up in step with that card's bottom edge. */}
        <div ref={rowsRef} className='mt-7 flex flex-col gap-24'>
          {sections.map((item, index) => (
            <section
              key={`${index}:${item.title}`}
              ref={(element) => {
                sectionsRef.current[index] = element
              }}
              aria-label={item.title}
              className='flex flex-col gap-3 pr-4 pl-13 @min-[1000px]/guide:flex-row @min-[1000px]/guide:gap-0 @min-[1000px]/guide:p-0'
            >
              <div className='@min-[1000px]/guide:w-100 @min-[1000px]/guide:shrink-0 @min-[1000px]/guide:pr-5 @min-[1000px]/guide:pl-13'>
                <div className='@min-[1000px]/guide:sticky @min-[1000px]/guide:top-7'>
                  <RailHead section={item} total={total} note={index === 0 ? note : undefined} />
                </div>
              </div>
              <div className='min-w-0 flex-1 @min-[1000px]/guide:pr-4 @min-[1000px]/guide:pl-2'>
                {index === 0 ? (
                  <FileList files={files} onSelect={openFile} />
                ) : (
                  item.parts.map((part) => {
                    const key = partKey(index, part.file.path)
                    return renderCard(part, key, viewed.has(key), (checked) =>
                      setViewed((previous) => {
                        const next = new Set(previous)
                        if (checked) next.add(key)
                        else next.delete(key)
                        return next
                      })
                    )
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      <Minimap
        sections={sections}
        current={current}
        viewed={done}
        onSelect={(index) => scrollToLine(sectionsRef.current[index]!)}
      />
    </div>
  )
}
