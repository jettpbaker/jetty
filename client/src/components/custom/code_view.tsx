import type { CodeViewOptions } from '@pierre/diffs'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from '@pierre/trees'
import { useCallback, useMemo, useState } from 'react'

import { ArrowDown01Icon, ArrowRight01Icon } from './huge_icons'
import { codeSurfaceCSS, syntaxTheme } from './syntax_theme'
import './file_changes_viewer.css'

const separatorUnsafeCSS = `
  [data-separator="line-info"] {
    height: 26px;
    min-height: 26px;
    margin-block: 0;
    box-sizing: border-box;
    background: transparent;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  [data-separator="line-info"] [data-separator-wrapper],
  [data-separator="line-info"] [data-separator-content],
  [data-separator="line-info"] [data-expand-button] {
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    min-width: 0;
    min-height: 0;
    padding: 0;
    margin: 0;
  }
  [data-separator="line-info"] [data-separator-wrapper] {
    position: absolute;
    inset: 0;
    width: auto;
    display: flex;
    align-items: center;
    height: 100%;
  }
  [data-separator="line-info"] [data-expand-all-button] { display: none; }
  [data-separator="line-info"] [data-expand-up] [data-icon] { transform: scaleY(-1); }
  [data-separator="line-info"] [data-expand-down] [data-icon] { transform: none; }
  [data-gutter] [data-separator="line-info"] [data-separator-wrapper] {
    justify-content: center;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding-left: 2ch;
    padding-right: 1ch;
  }
  [data-gutter] [data-separator="line-info"] [data-separator-content] { display: none; }
  [data-gutter] [data-separator="line-info"] [data-expand-button]:not([data-expand-all-button]) {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    width: 16px;
    height: 16px;
    color: var(--muted-foreground);
  }
  [data-gutter] [data-separator-wrapper][data-separator-multi-button] [data-expand-button]:not([data-expand-all-button]) {
    height: 10px;
  }
  [data-gutter] [data-separator-wrapper][data-separator-multi-button] [data-expand-down] {
    margin-top: -2px;
  }
  [data-gutter] [data-separator="line-info"] [data-expand-button] svg {
    width: 12px;
    height: 12px;
  }
  [data-additions] [data-gutter] [data-separator="line-info"] [data-expand-button] { display: none; }
  [data-content] [data-separator="line-info"] [data-separator-wrapper] {
    justify-content: flex-start;
    padding-inline: 1ch;
    width: 100%;
  }
  [data-content] [data-separator="line-info"] [data-expand-button] { display: none; }
  [data-content] [data-separator="line-info"] [data-separator-content] {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    gap: 1ch;
    font-size: var(--text-xs);
    text-decoration: none;
  }
  [data-content] [data-separator="line-info"] [data-separator-content]::before,
  [data-content] [data-separator="line-info"] [data-separator-content]::after {
    content: "";
    height: 0.5px;
    background-color: var(--muted-foreground);
  }
  [data-content] [data-separator="line-info"] [data-separator-content]::before {
    flex: none;
    width: 12px;
  }
  [data-content] [data-separator="line-info"] [data-separator-content]::after {
    flex: 1 1 auto;
    min-width: 1ch;
  }
  [data-content] [data-unmodified-lines] {
    flex: none;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
  [data-additions] [data-content] [data-separator-content] { display: none; }
  [data-separator="line-info"][data-row-hover] {
    background-color: var(--accent);
    color: var(--foreground);
    fill: currentColor;
  }
  [data-gutter] [data-separator="line-info"][data-row-hover] [data-expand-button]:not([data-expand-all-button]),
  [data-separator="line-info"][data-row-hover] [data-expand-up],
  [data-separator="line-info"][data-row-hover] [data-expand-down],
  [data-separator="line-info"][data-row-hover] [data-expand-both],
  [data-separator="line-info"][data-row-hover] [data-unmodified-lines] {
    color: var(--foreground);
    fill: currentColor;
  }
  [data-gutter] [data-separator="line-info"][data-row-hover] [data-expand-button] svg,
  [data-gutter] [data-separator="line-info"][data-row-hover] [data-icon] {
    color: var(--foreground);
    fill: currentColor;
  }
`

export function diffViewOptions(
  themeType: 'light' | 'dark',
  {
    split = false,
    loadDiffFiles,
    lineNumbers = true,
  }: {
    split?: boolean
    loadDiffFiles?: CodeViewOptions<undefined, undefined>['loadDiffFiles']
    lineNumbers?: boolean
  }
): CodeViewOptions<undefined, undefined> {
  return {
    diffStyle: split ? 'split' : 'unified',
    theme: syntaxTheme,
    themeType,
    preferredHighlighter: 'shiki-wasm',
    stickyHeaders: true,
    itemMetrics: {
      diffHeaderHeight: 36,
      lineHeight: 20,
      hunkSeparatorHeight: lineNumbers ? 26 : 4,
    },
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    hunkSeparators: lineNumbers ? 'line-info' : 'simple',
    disableLineNumbers: !lineNumbers,
    expansionLineCount: 20,
    loadDiffFiles,
    unsafeCSS: `
      ${codeSurfaceCSS}
      [data-diffs-header] { height: 36px; min-height: 36px; box-sizing: border-box; background-color: var(--background); border-bottom: 1px solid var(--border); }
      [data-diffs-header]::before {
        content: ''; position: absolute; inset: -1px 0 auto; height: 1px; pointer-events: none;
        background: linear-gradient(var(--border), var(--border)), var(--background);
      }
      [data-diffs-header] [data-change-icon] { display: none; }
      [data-diffs-header]:hover { --file-icon-opacity: 0; --file-chevron-opacity: 1; }
      ${separatorUnsafeCSS}
    `,
    overflow: split ? 'wrap' : 'scroll',
  }
}

export function useCollapsedFiles(initial: () => Set<string>) {
  const [collapsedFiles, setCollapsedFiles] = useState(initial)
  const renderFilePrefix = useCallback(
    (item: { id: string; collapsed?: boolean }) => (
      <FileCollapseButton
        path={item.id}
        collapsed={item.collapsed ?? false}
        onToggle={() =>
          setCollapsedFiles((previous) => {
            const next = new Set(previous)
            if (next.has(item.id)) next.delete(item.id)
            else next.add(item.id)
            return next
          })
        }
      />
    ),
    []
  )
  const expand = useCallback(
    (path: string) =>
      setCollapsedFiles((previous) => {
        if (!previous.has(path)) return previous
        const next = new Set(previous)
        next.delete(path)
        return next
      }),
    []
  )
  return { collapsedFiles, renderFilePrefix, expand }
}

const fileIconResolver = createFileTreeIconResolver('standard')
const fileIconSprite = getBuiltInSpriteSheet('standard')

// The file's language glyph, from the trees library's icon set.
export function FileLanguageIcon({ path, className }: { path: string; className?: string }) {
  const icon = fileIconResolver.resolveIcon('file-tree-icon-file', path)
  const iconMarkup = useMemo(() => {
    const start = fileIconSprite.indexOf(`<symbol id="${icon.name}"`)
    if (start < 0) return ''
    const end = fileIconSprite.indexOf('</symbol>', start)
    return fileIconSprite
      .slice(start, end + 9)
      .replace(`<symbol id="${icon.name}"`, '<svg')
      .replace('</symbol>', '</svg>')
  }, [icon.name])
  return (
    <span
      className={cn('file-language-icon size-5', className)}
      data-language={icon.token}
      aria-hidden='true'
      dangerouslySetInnerHTML={{ __html: iconMarkup }}
    />
  )
}

function FileCollapseButton({
  path,
  collapsed,
  onToggle,
}: {
  path: string
  collapsed: boolean
  onToggle: () => void
}) {
  const Chevron = collapsed ? ArrowDown01Icon : ArrowRight01Icon
  return (
    <Button
      variant='ghost-text'
      size='icon'
      className='file-collapse-button relative aria-expanded:text-muted-foreground'
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${path}`}
      aria-expanded={!collapsed}
      onClick={onToggle}
      data-collapsed={collapsed}
    >
      <FileLanguageIcon path={path} className='absolute' />
      <Chevron className='file-collapse-chevron absolute' aria-hidden='true' />
    </Button>
  )
}
