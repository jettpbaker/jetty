import type { GitStatus } from '@pierre/trees'

import { charmedFolderNames, charmedFolderSymbols } from '@/components/custom/charmed_folders'
import {
  charmedExtensions,
  charmedFileNames,
  charmedSprite,
} from '@/components/custom/charmed_icons'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect, useRef } from 'react'

import './changed_files_tree.css'
import '@/components/custom/charmed_icons.css'

const treeRowHeight = 26
// Hugeicons ArrowDown01. trees.software rotates the chevron slot -90deg when collapsed, so one glyph covers both states.
const treeCaretSprite =
  '<symbol id="jetty-caret-down" viewBox="1.333333 1.333333 21.333333 21.333333"><path fill="none" stroke="currentColor" stroke-width="1.333" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9"/></symbol><symbol id="jetty-empty" viewBox="0 0 6 6"></symbol>'
const treeRemap = {
  'file-tree-icon-chevron': {
    name: 'jetty-caret-down',
    width: 12,
    height: 12,
    viewBox: '0 0 256 256',
  },
  // Every folder in a PR tree contains changes, so the "has changes" dot carries no information.
  'file-tree-icon-dot': { name: 'jetty-empty', width: 6, height: 6, viewBox: '0 0 6 6' },
}
const builtInIcons = {
  set: 'complete',
  colored: true,
  spriteSheet: `<svg aria-hidden="true" width="0" height="0">${treeCaretSprite}</svg>`,
  remap: treeRemap,
} as const
const charmedIcon = (icon: string) => ({
  name: `ci-${icon}`,
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
})
const remapAll = (icons: Record<string, string>) =>
  Object.fromEntries(Object.entries(icons).map(([key, icon]) => [key, charmedIcon(icon)]))
const charmedFolder = (name: string, open: boolean) =>
  `${charmedFolderNames[name.toLowerCase()] ?? '_folder'}${open ? '_open' : ''}`
// Charmed Icons' Soft palette: its symbols colour themselves from --ci-* variables, which the host's
// data-charmed attribute sets and the tree's shadow root inherits. The sprite carries only the folder
// glyphs this tree's folders use, open and shut.
function charmedIcons(paths: string[]) {
  const folders = new Set(
    paths.flatMap((path) =>
      path
        .split('/')
        .slice(0, -1)
        .flatMap((name) => [charmedFolder(name, false), charmedFolder(name, true)])
    )
  )
  return {
    set: 'none',
    spriteSheet: `<svg aria-hidden="true" width="0" height="0">${treeCaretSprite}${charmedSprite}${[...folders].map((icon) => charmedFolderSymbols[icon]).join('')}</svg>`,
    remap: { ...treeRemap, 'file-tree-icon-file': charmedIcon('_file') },
    byFileName: remapAll(charmedFileNames),
    byFileExtension: remapAll(charmedExtensions),
  } as const
}
// The library gives folders only its caret slot, so a folder's Charmed glyph (named for the folder, as
// in the editor theme) rides in the decoration slot, moved to where the caret was; the glyph's open and
// shut forms carry the state, so the caret goes.
const charmedFolderUnsafeCSS = [
  '[data-item-type="folder"] > [data-item-section="icon"] { display: none; }',
  '[data-item-type="folder"] > [data-item-section="decoration"] { order: -1; flex: none; width: 16px; margin: 0; padding: 0; }',
].join('\n')
// Linear's review tree: a file's name carries its change (added green, deleted struck through) rather
// than a status letter; indent guides stay on; open comment counts sit in a badge.
const namesUnsafeCSS = [
  '[data-item-section="git"] { display: none; }',
  '[data-item-git-status="added"] > [data-item-section="content"] { color: var(--status-success); }',
  '[data-item-git-status="deleted"] > [data-item-section="content"] { text-decoration: line-through; }',
  '[data-item-section="spacing"] { order: -1; }',
  '[data-item-section="spacing-item"] { opacity: 1; }',
  '[data-item-type="folder"] > [data-item-section="content"] { color: var(--muted-foreground); }',
].join('\n')
const badgeUnsafeCSS =
  '[data-item-type="file"] > [data-item-section="decoration"] > span { height: 18px; padding-inline: 6px; border-radius: 6px; background: var(--accent); color: var(--muted-foreground); font-variant-numeric: tabular-nums; }'
const countsUnsafeCSS =
  '[data-item-type="file"] > [data-item-section="decoration"] > span { gap: 6px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }'
// `unsafeCSS` is the library's documented escape hatch (@layer unsafe). Sidebar rows keep label text in
// --foreground and only colour the trailing status mark, so undo the library's label tint.
const treeUnsafeCSS = [
  '[role="treeitem"][data-item-focused="true"]:not(:focus-visible)::before { outline: none; }',
  '[data-item-git-status] > [data-item-section="content"] { color: inherit; }',
  '[data-item-section="git"] { font-size: var(--text-xs); }',
].join('\n')

export function ChangedFilesTree({
  files,
  selected,
  onSelect,
  icons = 'built-in',
  markers = 'letters',
  comments,
  counts,
  active,
}: {
  files: { path: string; status: GitStatus }[]
  selected: string | null
  onSelect: (path: string) => void
  icons?: 'built-in' | 'charmed'
  // How a file's change shows: a trailing status letter, or (Linear's way) on the name itself.
  markers?: 'letters' | 'names'
  // Open comment threads per path, shown at the end of the row.
  comments?: Record<string, number>
  // Or each file's added and removed lines (Capy's file menu), in the status colours.
  counts?: Record<string, { additions: number; deletions: number }>
  // The file in view, which the selection follows as the diff scrolls (Linear's tracking). Selecting it
  // reports through onSelect too, so the caller ignores that report.
  active?: string | null
}) {
  const paths = new Set(files.map((file) => file.path))
  const modelRef = useRef<ReturnType<typeof useFileTree>['model'] | null>(null)
  const lastFile = useRef(selected)
  const restoring = useRef(false)
  const { model } = useFileTree({
    paths: files.map((file) => file.path),
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    itemHeight: markers === 'names' ? 28 : treeRowHeight,
    icons: icons === 'charmed' ? charmedIcons([...paths]) : builtInIcons,
    unsafeCSS: [
      treeUnsafeCSS,
      markers === 'names' && namesUnsafeCSS,
      icons === 'charmed' && charmedFolderUnsafeCSS,
      counts ? countsUnsafeCSS : comments && badgeUnsafeCSS,
    ]
      .filter(Boolean)
      .join('\n'),
    initialSelectedPaths: selected ? [selected] : [],
    gitStatus: files.map(({ path, status }) => ({ path, status })),
    renderRowDecoration: ({ row }) => {
      if (row.kind === 'directory') {
        if (icons !== 'charmed') return null
        return {
          icon: charmedIcon(
            charmedFolder(row.flattenedSegments?.at(-1)?.name ?? row.name, row.isExpanded)
          ),
        }
      }
      const lines = counts?.[row.path]
      if (lines) {
        const parts = [
          lines.additions ? { text: `+${lines.additions}`, color: 'var(--status-success)' } : null,
          lines.deletions ? { text: `−${lines.deletions}`, color: 'var(--status-error)' } : null,
        ].filter((part) => part !== null)
        return parts.length ? { text: parts.map((part) => part.text).join(' '), parts } : null
      }
      const count = comments?.[row.path]
      return count
        ? { text: String(count), title: `${count} open ${count === 1 ? 'comment' : 'comments'}` }
        : null
    },
    onSelectionChange: (selection) => {
      // A folder click only opens or shuts it; the selection goes back to the file it was on.
      const folders = selection.filter((path) => !paths.has(path))
      if (folders.length) {
        queueMicrotask(() => {
          restoring.current = true
          for (const path of folders) modelRef.current?.getItem(path)?.deselect()
          if (lastFile.current) modelRef.current?.getItem(lastFile.current)?.select()
          restoring.current = false
        })
        return
      }
      const path = selection.at(-1)
      if (!path || restoring.current) return
      lastFile.current = path
      onSelect(path)
    },
  })
  useEffect(() => {
    modelRef.current = model
  }, [model])
  useEffect(() => {
    const item = active ? model.getItem(active) : null
    if (!item || item.isSelected()) return
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect()
    item.select()
    model.scrollToPath(active!, { focus: false })
  }, [model, active])
  return (
    <FileTree
      model={model}
      data-charmed={icons === 'charmed' ? 'soft' : undefined}
      className='changed-files-tree h-full w-full'
    />
  )
}
