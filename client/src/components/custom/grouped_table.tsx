import { Button } from '@/components/ui/button'
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { ArrowRight01Icon } from './huge_icons'
import './grouped_table.css'

export type GroupedColumn<T> = {
  id: string
  label: string
  icon: ReactNode
  /** Higher priorities survive longer. Title and essential columns never collapse. */
  priority: number
  width: number
  title?: boolean
  essential?: boolean
  visible?: boolean
  render: (row: T, context: { collapsed: ReadonlySet<string> }) => ReactNode
}

export type TableGroup<T> = {
  id: string
  label: string
  icon: ReactNode
  color: string
  rows: readonly T[]
  defaultCollapsed?: boolean
}

type GroupedTableProps<T> = {
  label: string
  columns: readonly GroupedColumn<T>[]
  groups: readonly TableGroup<T>[]
  rowKey: (row: T) => string | number
  rowLabel: (row: T) => string
  selectedKey?: string | number
  onSelect?: (row: T) => void
  empty?: string
}

/** One observer per table; every row keeps the same tracks, including zero-width ones. */
export function GroupedTable<T>({
  label,
  columns,
  groups,
  rowKey,
  rowLabel,
  selectedKey,
  onSelect,
  empty = 'No results.',
}: GroupedTableProps<T>) {
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const [width, setWidth] = useState(0)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const collapsed = new Set(
    columns.filter((column) => column.visible === false).map((column) => column.id)
  )
  let required = 40
  for (const column of columns) {
    if (!collapsed.has(column.id)) required += column.width
  }
  const naturalWidth = required
  const removable = columns
    .filter((column) => !column.title && !column.essential && !collapsed.has(column.id))
    .toSorted((a, b) => a.priority - b.priority)
  for (const column of removable) {
    if (required <= width) break
    collapsed.add(column.id)
    required -= column.width
  }
  const template = columns
    .map((column) =>
      column.title ? 'minmax(0, 1fr)' : `${collapsed.has(column.id) ? 0 : column.width}px`
    )
    .join(' ')
  const gridStyle = { gridTemplateColumns: template }
  const wide = width >= Math.max(760, naturalWidth)

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || !root.current) return
    const step = { ArrowDown: 1, ArrowUp: -1, j: 1, k: -1 }[event.key]
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') return
    const targets = Array.from(
      root.current.querySelectorAll<HTMLButtonElement>('[data-table-focus]')
    ).filter((target) => !target.closest('[hidden]'))
    const index = targets.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? targets.length - 1
          : index === -1
            ? 0
            : Math.max(0, Math.min(targets.length - 1, index + (step ?? 0)))
    if (!targets[next]) return
    event.preventDefault()
    targets[next].focus()
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- keyboard navigation delegates to the table's native buttons
    <div
      ref={root}
      className='grouped-table scrollbar-subtle'
      aria-label={label}
      onKeyDown={moveFocus}
    >
      <div className='grouped-table-columns' data-wide={wide} aria-hidden={!wide}>
        <div className='grouped-table-grid' style={gridStyle}>
          {columns.map((column) => (
            <span
              key={column.id}
              className='grouped-table-cell text-muted-foreground'
              data-collapsed={collapsed.has(column.id)}
              aria-hidden={collapsed.has(column.id) || undefined}
              title={column.label}
            >
              {column.icon}
              <span className='sr-only'>{column.label}</span>
            </span>
          ))}
        </div>
      </div>
      {groups.map((group) => {
        const closed = collapsedGroups[group.id] ?? group.defaultCollapsed ?? false
        const headerId = `${id}-${group.id}-header`
        const bodyId = `${id}-${group.id}-rows`
        return (
          <section key={group.id} className='grouped-table-group' aria-labelledby={headerId}>
            <h2
              className='grouped-table-heading'
              style={{ '--group-color': group.color } as CSSProperties}
            >
              <Button
                id={headerId}
                variant='ghost-text'
                className='grouped-table-group-button'
                aria-expanded={!closed}
                aria-controls={bodyId}
                data-table-focus
                onClick={() =>
                  setCollapsedGroups((current) => ({ ...current, [group.id]: !closed }))
                }
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                  event.preventDefault()
                  setCollapsedGroups((current) => ({
                    ...current,
                    [group.id]: event.key === 'ArrowLeft',
                  }))
                }}
              >
                <ArrowRight01Icon
                  className='grouped-table-chevron size-3 text-muted-foreground'
                  data-open={!closed}
                />
                {group.icon}
                <span>{group.label}</span>
                <span className='text-muted-foreground font-normal tabular-nums'>
                  {group.rows.length}
                </span>
              </Button>
            </h2>
            <div
              id={bodyId}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- preserve the sketchpad's div-based list markup
              role='list'
              aria-label={group.label}
              hidden={closed}
              className='grouped-table-rows'
            >
              {group.rows.map((row) => (
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- preserve the sketchpad's div-based list markup
                <div role='listitem' key={rowKey(row)}>
                  <button
                    type='button'
                    data-table-focus
                    className='grouped-table-grid grouped-table-row'
                    style={gridStyle}
                    data-selected={rowKey(row) === selectedKey}
                    aria-current={rowKey(row) === selectedKey || undefined}
                    aria-label={rowLabel(row)}
                    onClick={() => onSelect?.(row)}
                  >
                    {columns.map((column) => (
                      <span
                        key={column.id}
                        className='grouped-table-cell'
                        data-title={column.title || undefined}
                        data-collapsed={collapsed.has(column.id)}
                        aria-hidden={collapsed.has(column.id) || undefined}
                      >
                        {column.render(row, { collapsed })}
                      </span>
                    ))}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )
      })}
      {!groups.some((group) => group.rows.length) && (
        <p className='p-8 text-center text-sm text-muted-foreground'>{empty}</p>
      )}
    </div>
  )
}

export function GroupedTableTitle({
  title,
  secondary,
  tucked,
}: {
  title: string
  secondary: string
  tucked: boolean
}) {
  return (
    <span className='grouped-table-title' title={title}>
      <span className='truncate'>{title}</span>
      <span className='grouped-table-secondary' data-tucked={tucked} aria-hidden={!tucked}>
        <span className='truncate font-mono text-[11px] text-muted-foreground'>{secondary}</span>
      </span>
    </span>
  )
}

export function TableLabels({ labels }: { labels: readonly { name: string; color: string }[] }) {
  return (
    <span className='flex min-w-0 items-center gap-1'>
      {labels.map((label) => (
        <span
          key={label.name}
          className='inline-flex h-5 min-w-0 items-center gap-1.5 rounded-full border border-border px-1.5 text-[11px] text-muted-foreground'
          title={label.name}
        >
          <span
            className='size-1.5 shrink-0 rounded-full'
            style={{ backgroundColor: label.color }}
          />
          <span className='truncate'>{label.name}</span>
        </span>
      ))}
    </span>
  )
}
