import type { Attachment } from '@jetty/shared/items'

import { ImageThumbnail } from '@/components/custom/gallery_message'
import { ImageNotFound01Icon } from '@/components/custom/huge_icons'
import {
  fittedStyle,
  INLINE_IMAGE_MAX_HEIGHT,
  useImageSize,
} from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { VideoPlayer } from '@/components/custom/video_message'
import { cn } from '@/lib/utils'
import { githubMediaPath, githubMediaSource } from '@jetty/shared/github-media'
import { useEffect, useRef, useState } from 'react'

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

type MediaKind = 'image' | 'video'

// GitHub attachments load through the server, which holds the credentials; other media loads as is.
type Source = { href: string; path: string; github?: boolean }

export const markdownMediaTags = { video: ['src'], source: ['src', 'srcSet'] }

function textContent(node: HastNode): string {
  return node.value ?? (node.children ?? []).map(textContent).join('')
}

function dimension(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? String(number) : undefined
}

function githubSource(value: unknown): Source | null {
  const found = typeof value === 'string' ? githubMediaSource(value) : null
  return found && { href: found.href, path: githubMediaPath(found), github: true }
}

function webSource(value: unknown): Source | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
    ? { href: value, path: value }
    : null
}

function mediaNode(source: Source, kind: MediaKind | 'auto', from: HastNode, linked: boolean) {
  const { alt, width, height } = from.properties ?? {}
  const properties: Record<string, string> = { path: source.path, href: source.href, kind }
  if (source.github) properties.github = 'true'
  if (typeof alt === 'string' && alt.trim()) properties.alt = alt.trim()
  if (dimension(width) && dimension(height)) {
    properties.width = dimension(width)!
    properties.height = dimension(height)!
  }
  if (linked) properties.linked = 'true'
  return { type: 'element', tagName: 'markdown-media', properties, children: [] }
}

function isBlank(node: HastNode) {
  return node.tagName === 'br' || (node.type === 'text' && !node.value?.trim())
}

// An image alone on its line is media; one inside a sentence, like a badge, stays inline.
function ownLine(siblings: HastNode[], index: number) {
  return [-1, 1].every((step) => {
    for (let at = index + step; at >= 0 && at < siblings.length; at += step) {
      if (siblings[at]!.tagName === 'br') return true
      if (!isBlank(siblings[at]!)) return false
    }
    return true
  })
}

function replacement(node: HastNode, linked: boolean, onOwnLine: boolean): HastNode | null {
  if (node.type !== 'element') return null
  const properties = node.properties ?? {}
  if (node.tagName === 'img') {
    const found =
      githubSource(properties.src) ?? (onOwnLine && !linked ? webSource(properties.src) : null)
    return found ? mediaNode(found, 'image', node, linked) : null
  }
  if (node.tagName === 'video') {
    const src =
      properties.src ?? node.children?.find((child) => child.tagName === 'source')?.properties?.src
    const found = githubSource(src)
    if (found) return mediaNode(found, 'video', node, false)
    // GitHub drops <video> it didn't host; a link keeps the reference without playing it.
    return typeof src === 'string'
      ? {
          type: 'element',
          tagName: 'a',
          properties: { href: src },
          children: [{ type: 'text', value: src }],
        }
      : { type: 'text', value: '' }
  }
  // GitHub renders an attachment URL on its own as the media itself, like a video upload.
  if (node.tagName === 'a' && !linked) {
    const found = githubSource(properties.href)
    if (found && textContent(node).trim() === properties.href)
      return mediaNode(found, 'auto', node, false)
  }
  return null
}

function isBlockMedia(node: HastNode) {
  return node.tagName === 'markdown-media' && !node.properties?.linked
}

// Media can't sit inside a <p>, so the paragraph splits around it.
function splitParagraph(paragraph: HastNode): HastNode[] {
  const out: HastNode[] = []
  let run: HastNode[] = []
  function flush() {
    const start = run.findIndex((node) => !isBlank(node))
    const end = run.findLastIndex((node) => !isBlank(node))
    if (start >= 0) out.push({ ...paragraph, children: run.slice(start, end + 1) })
    run = []
  }
  for (const child of paragraph.children ?? []) {
    if (isBlockMedia(child)) {
      flush()
      out.push(child)
    } else run.push(child)
  }
  flush()
  return out
}

// Swaps images and videos for <markdown-media>, after sanitizing.
export function rehypeMarkdownMedia() {
  function visit(node: HastNode, linked: boolean, parent?: string) {
    const siblings = node.children ?? []
    // In a list item, media would leave the bullet on a line of its own.
    const lines = node.tagName === 'p' && parent !== 'li'
    const children: HastNode[] = []
    for (const [index, child] of siblings.entries()) {
      const swapped = replacement(child, linked, lines && ownLine(siblings, index))
      if (swapped) {
        children.push(swapped)
        continue
      }
      visit(child, linked || child.tagName === 'a', node.tagName)
      if (child.tagName === 'p' && child.children?.some(isBlockMedia))
        children.push(...splitParagraph(child))
      else children.push(child)
    }
    node.children = children
  }
  return (tree: HastNode) => visit(tree, false)
}

// A bare attachment link doesn't say what it is until the proxy has fetched it.
const probes = new Map<string, Promise<MediaKind>>()

function probe(path: string) {
  let pending = probes.get(path)
  if (!pending) {
    pending = fetch(path, { method: 'HEAD' }).then((response) => {
      if (!response.ok) throw new Error(`${response.status}`)
      return response.headers.get('content-type')?.startsWith('video/') ? 'video' : 'image'
    })
    pending.catch(() => probes.delete(path))
    probes.set(path, pending)
  }
  return pending
}

export function MarkdownMedia({
  path = '',
  href = '',
  kind,
  alt,
  width,
  height,
  linked,
  github,
}: {
  path?: string
  href?: string
  kind?: string
  alt?: string
  width?: string
  height?: string
  linked?: string
  github?: string
}) {
  const openMedia = useOpenMedia()
  const thumbnail = useRef<HTMLButtonElement>(null)
  const [resolved, setResolved] = useState<MediaKind | 'failed' | undefined>(
    kind === 'image' || kind === 'video' ? kind : undefined
  )
  const sized = width && height ? { width: Number(width), height: Number(height) } : undefined
  // An image with no recorded size holds a frame until its file says, so it lands at its own size.
  const measured = useImageSize(path, resolved === 'image' && !sized && !linked)

  useEffect(() => {
    if (resolved) return
    let live = true
    probe(path).then(
      (found) => live && setResolved(found),
      () => live && setResolved('failed')
    )
    return () => {
      live = false
    }
  }, [path, resolved])

  const size = sized ?? (resolved === 'image' && measured !== 'failed' ? measured : undefined)
  const attachment: Attachment = {
    id: path,
    name: alt ?? (resolved === 'video' ? 'Video' : 'Image'),
    mimeType: resolved === 'video' ? 'video/*' : 'image/*',
    sizeBytes: 0,
    ...size,
  }
  const failed = () => setResolved('failed')

  if (resolved === 'failed' || (resolved === 'image' && measured === 'failed'))
    return (
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='inline-flex w-fit items-center gap-2 rounded-lg bg-muted px-3 py-2 align-middle text-xs whitespace-nowrap text-muted-foreground no-underline transition-colors hover:text-foreground'
      >
        <ImageNotFound01Icon className='size-4 shrink-0' />
        {github ? "Couldn't load attachment · Open on GitHub" : "Couldn't load image · Open link"}
      </a>
    )
  if (!resolved || (resolved === 'image' && !size && !linked))
    return <div className='aspect-video max-h-120 w-full rounded-md bg-muted' />
  if (resolved === 'video') return <VideoPlayer video={attachment} actions onError={failed} />
  if (linked)
    return (
      <img
        src={path}
        alt={attachment.name}
        loading='lazy'
        decoding='async'
        className={cn('max-w-full rounded-md', !attachment.width && 'max-h-120')}
        style={fittedStyle(attachment, INLINE_IMAGE_MAX_HEIGHT)}
        onError={failed}
      />
    )
  return (
    <ImageThumbnail
      ref={thumbnail}
      image={attachment}
      onOpen={() => openMedia({ items: [attachment], index: 0, origin: () => thumbnail.current })}
      onError={failed}
    />
  )
}
