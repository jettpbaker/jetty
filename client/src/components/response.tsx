import type { ComponentProps } from 'react'
import type { StreamdownProps, ThemeRegistrationAny } from 'streamdown'

import { createCodePlugin } from '@/components/code-plugin'
import { cn } from '@/lib/utils'
// Zed "VS Code 2026 Dark" (~/.config/zed/themes/vscode-2026.json), ported to
// TextMate scopes for Shiki. Not the microsoft/vscode theme-defaults JSON.
import dark2026Json from '@/themes/dark-2026.json'
import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowsOutSimpleIcon,
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
  DownloadSimpleIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  XIcon,
} from '@phosphor-icons/react'
import { memo } from 'react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'

import './streamdown-overrides.css'

const dark2026 = dark2026Json as ThemeRegistrationAny

// streamdown prefers plugins.code.getThemes() over the shikiTheme prop — so the
// theme has to be baked into the plugin. shikiTheme is kept in sync for anything
// that still reads it off context.
const codePlugin = createCodePlugin([dark2026, dark2026])

export type ResponseProps = ComponentProps<typeof Streamdown>

/** Compact single-card fence overrides on streamdown's CodeBlock DOM. */
const markdownFenceClassName = [
  // outer: no card at all — fences sit truly inline with the prose
  '[&_[data-streamdown=code-block]]:my-3',
  '[&_[data-streamdown=code-block]]:relative',
  '[&_[data-streamdown=code-block]]:gap-0',
  '[&_[data-streamdown=code-block]]:rounded-none',
  '[&_[data-streamdown=code-block]]:border-0',
  '[&_[data-streamdown=code-block]]:!bg-transparent',
  '[&_[data-streamdown=code-block]]:p-0',
  '[&_[data-streamdown=code-block]]:overflow-hidden',
  // language header is a full-width row — drop it (awkward with top-right copy)
  '[&_[data-streamdown=code-block-header]]:hidden',
  // actions wrapper is sticky/-mt-10 for the default header row; pin top-right instead
  '[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:absolute',
  '[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:top-1.5',
  '[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:right-1.5',
  '[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:z-10',
  '[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:m-0',
  '[&_[data-streamdown=code-block]>div:has([data-streamdown=code-block-actions])]:h-auto',
  // copy: ghost, small, hover-reveal (resting state = just code)
  '[&_[data-streamdown=code-block-actions]]:border-0',
  '[&_[data-streamdown=code-block-actions]]:!bg-transparent',
  '[&_[data-streamdown=code-block-actions]]:p-0',
  '[&_[data-streamdown=code-block-actions]]:shadow-none',
  '[&_[data-streamdown=code-block-actions]]:opacity-0',
  '[&_[data-streamdown=code-block-actions]]:transition-opacity',
  '[&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100',
  '[&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100',
  '[&_[data-streamdown=code-block-copy-button]]:inline-flex',
  '[&_[data-streamdown=code-block-copy-button]]:size-6',
  '[&_[data-streamdown=code-block-copy-button]]:items-center',
  '[&_[data-streamdown=code-block-copy-button]]:justify-center',
  '[&_[data-streamdown=code-block-copy-button]]:rounded-md',
  '[&_[data-streamdown=code-block-copy-button]]:text-muted-foreground',
  '[&_[data-streamdown=code-block-copy-button]]:hover:bg-muted',
  '[&_[data-streamdown=code-block-copy-button]]:hover:text-foreground',
  // body: drop second card, compact padding + 13px type
  '[&_[data-streamdown=code-block-body]]:rounded-none',
  '[&_[data-streamdown=code-block-body]]:border-0',
  '[&_[data-streamdown=code-block-body]]:!bg-transparent',
  '[&_[data-streamdown=code-block-body]]:p-0',
  '[&_[data-streamdown=code-block-body]]:text-[13px]',
  '[&_[data-streamdown=code-block-body]]:leading-normal',
  // with lineNumbers off streamdown leaves line spans classless and inline
  // (its `block` rides the line-number class) — restack lines ourselves
  '[&_[data-streamdown=code-block-body]_code>span]:block',
  // neutralize Shiki theme background so bg-card wins
  '[&_[data-streamdown=code-block-body]_pre]:!bg-transparent',
  '[&_[data-streamdown=code-block-body]_code]:text-[13px]',
  '[&_[data-streamdown=code-block-body]_code]:leading-normal',
].join(' ')

export const markdownDefaults = {
  shikiTheme: [dark2026, dark2026],
  controls: { code: { download: false } },
  // links open directly — no "external link" confirmation modal
  linkSafety: { enabled: false },
  lineNumbers: false,
  // word-level blur-in while streaming; inert unless isAnimating is passed true
  animated: { animation: 'blurIn', duration: 260, easing: 'ease-out', sep: 'word', stagger: 0 },
  plugins: { code: codePlugin },
  className: markdownFenceClassName,
  // streamdown's built-ins are inlined lucide; jetty speaks Phosphor
  icons: {
    CheckIcon,
    CopyIcon,
    DownloadIcon: DownloadSimpleIcon,
    ExternalLinkIcon: ArrowSquareOutIcon,
    Loader2Icon: CircleNotchIcon,
    Maximize2Icon: ArrowsOutSimpleIcon,
    RotateCcwIcon: ArrowCounterClockwiseIcon,
    XIcon,
    ZoomInIcon: MagnifyingGlassPlusIcon,
    ZoomOutIcon: MagnifyingGlassMinusIcon,
  },
} satisfies Partial<StreamdownProps>

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      {...markdownDefaults}
      className={cn(
        markdownDefaults.className,
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        // inline code only — fenced blocks (pre > code) keep their own treatment
        '[&_:not(pre)>code]:bg-code [&_:not(pre)>code]:text-code-foreground',
        // app chrome uses default cursors; streamdown's buttons ship cursor-pointer.
        // links stay pointer — they leave the app, unlike chrome controls. streamdown
        // renders link-safety links as <button data-streamdown=link>, so target the
        // attribute, not the tag
        '[&_button]:cursor-default [&_[data-streamdown=link]]:cursor-pointer',
        // links carry the signature ember
        '[&_[data-streamdown=link]]:text-code-foreground [&_[data-streamdown=link]:hover]:text-code-glow',
        // bullets: plain dash marker instead of the disc
        "[&_ul]:[list-style-type:'-_']",
        'motion-reduce:[&_[data-sd-animate]]:animate-none',
        className
      )}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && prevProps.isAnimating === nextProps.isAnimating
)

Response.displayName = 'Response'
