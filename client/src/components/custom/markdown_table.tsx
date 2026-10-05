import type { ExtraProps } from 'streamdown'

import { Button } from '@/components/ui/button'
import { cn } from 'cn'
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react'

type Props<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & ExtraProps

const align = 'text-left [&[align=center]]:text-center [&[align=right]]:text-right'
const well = 'bg-[color-mix(in_oklch,var(--muted)_60%,var(--background))]'
// A bordered card, full width; a table whose content can't fit grows past the column and scrolls.
// Separate borders, or the rounded border doesn't draw. Inline code steps down to the table's size and
// wraps rather than running into the next column, but a short token stays whole.
const table =
  'w-full border-separate border-spacing-0 rounded-md border border-border text-xs tabular-nums [&_code]:px-1 [&_code]:py-px [&_code]:text-xs [&_code]:wrap-anywhere [&_code[data-token]]:whitespace-nowrap'

// Long tables show this many rows behind a "Show all" toggle; two over isn't worth hiding.
const rowLimit = 8
const RowLimit = createContext<number | undefined>(undefined)

function bodyRows(children: ReactNode) {
  const body = Children.toArray(children).filter(isValidElement).at(-1) as
    | ReactElement<{ children?: ReactNode }>
    | undefined
  return Children.toArray(body?.props.children).filter(isValidElement)
}

export function MarkdownTable({
  node: _node,
  className: _className,
  children,
  ...props
}: Props<'table'>) {
  const [all, setAll] = useState(false)
  const count = bodyRows(children).length
  const long = count > rowLimit + 2
  return (
    <div className='my-4'>
      <div className='scrollbar-subtle scroll-fade-x overflow-x-auto'>
        <RowLimit value={long && !all ? rowLimit : undefined}>
          <table className={table} {...props}>
            {children}
          </table>
        </RowLimit>
      </div>
      {long && (
        <Button
          variant='ghost-text'
          size='xs'
          className='mt-1 -ml-1 px-1'
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? 'Show fewer rows' : `Show all ${count} rows`}
        </Button>
      )}
    </div>
  )
}

export function MarkdownTableBody({
  node: _node,
  className: _className,
  children,
  ...props
}: Props<'tbody'>) {
  const limit = useContext(RowLimit)
  const rows = Children.toArray(children).filter(isValidElement)
  return (
    <tbody className='[&>tr:last-child>td]:border-b-0' {...props}>
      {limit === undefined ? rows : rows.slice(0, limit)}
    </tbody>
  )
}

// The bare elements, without Streamdown's own table classes.
export function MarkdownTableHead({
  node: _node,
  className: _className,
  ...props
}: Props<'thead'>) {
  return <thead {...props} />
}

export function MarkdownTableRow({ node: _node, className: _className, ...props }: Props<'tr'>) {
  return <tr {...props} />
}

// The header row is a band on the code-block well, flush across the top. Its corner cells carry the
// radius, since a table doesn't clip its cells to its own.
export function MarkdownTableHeader({ node: _node, className: _className, ...props }: Props<'th'>) {
  return (
    <th
      className={cn(
        'h-8 border-b border-border px-3 font-normal whitespace-nowrap text-muted-foreground first:rounded-tl-[calc(var(--radius-md)-1px)] last:rounded-tr-[calc(var(--radius-md)-1px)]',
        well,
        align
      )}
      {...props}
    />
  )
}

function textLength(node: ReactNode): number {
  if (typeof node === 'string') return node.length
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + textLength(child), 0)
  if (isValidElement<{ children?: ReactNode }>(node)) return textLength(node.props.children)
  return 0
}

// Long prose wraps at 24rem so one wordy cell can't stretch the whole table, and keeps 10rem when
// whole code tokens crowd the table, rather than a word a line.
export function MarkdownTableCell({
  node: _node,
  className: _className,
  children,
  ...props
}: Props<'td'>) {
  return (
    <td className={cn('border-b border-border px-3 py-2 align-top', align)} {...props}>
      <div
        className={cn(
          'max-w-96 [[align=center]>&]:mx-auto [[align=right]>&]:ml-auto',
          textLength(children) > 40 && 'min-w-40'
        )}
      >
        {children}
      </div>
    </td>
  )
}
