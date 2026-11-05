import type { ExtraProps } from 'streamdown'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
// Wide tables scroll; code tokens stay whole unless a long cell needs to wrap.
const table =
  'w-full border-separate border-spacing-0 text-13 leading-5 tabular-nums [&_code]:px-1 [&_code]:py-px [&_code]:text-xs [&_code]:wrap-anywhere [&_code[data-token]]:whitespace-nowrap'

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

export function MarkdownTableHeader({ node: _node, className: _className, ...props }: Props<'th'>) {
  return (
    <th
      className={cn(
        'h-8 border-b border-border px-3 text-xs font-medium whitespace-nowrap text-muted-foreground',
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
    <td
      className={cn('border-b border-border px-3 py-2 align-top first:font-medium', align)}
      {...props}
    >
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
