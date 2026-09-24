import type { Attachment } from '@jetty/shared/items'

import { ImageThumbnail } from '@/components/custom/gallery_message'
import { fittedStyle, INLINE_IMAGE_MAX_HEIGHT } from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { VideoPlayer } from '@/components/custom/video_message'
import { cn } from '@/lib/utils'
import { githubMediaPath, githubMediaSource } from '@jetty/shared/github-media'
import { ImageBrokenIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

type MediaKind = 'image' | 'video'

export const githubMediaTags = { video: ['src'], source: ['src', 'srcSet'] }

function textContent(node: HastNode): string {
  return node.value ?? (node.children ?? []).map(textContent).join('')
}

function dimension(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? String(number) : undefined
}

function mediaNode(source: URL, kind: MediaKind | 'auto', from: HastNode, linked: boolean) {
  const { alt, width, height } = from.properties ?? {}
  const properties: Record<string, string> = {
    path: githubMediaPath(source),
    href: source.href,
    kind,
  }
  if (typeof alt === 'string' && alt.trim()) properties.alt = alt.trim()
  if (dimension(width) && dimension(height)) {
    properties.width = dimension(width)!
    properties.height = dimension(height)!
  }
  if (linked) properties.linked = 'true'
  return { type: 'element', tagName: 'github-media', properties, children: [] }
}

function source(value: unknown) {
  return typeof value === 'string' ? githubMediaSource(value) : null
}

function replacement(node: HastNode, linked: boolean): HastNode | null {
  if (node.type !== 'element') return null
  const properties = node.properties ?? {}
  if (node.tagName === 'img') {
    const found = source(properties.src)
    return found ? mediaNode(found, 'image', node, linked) : null
  }
  if (node.tagName === 'video') {
    const src =
      properties.src ?? node.children?.find((child) => child.tagName === 'source')?.properties?.src
    const found = source(src)
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
    const found = source(properties.href)
    if (found && textContent(node).trim() === properties.href)
      return mediaNode(found, 'auto', node, false)
  }
  return null
}

function isBlockMedia(node: HastNode) {
  return node.tagName === 'github-media' && node.properties?.kind !== 'image'
}

function isBlank(node: HastNode) {
  return node.tagName === 'br' || (node.type === 'text' && !node.value?.trim())
}

// A player can't sit inside a <p>, so the paragraph splits around it.
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

// Swaps GitHub-hosted images and videos for <github-media>, after sanitizing.
export function rehypeGithubMedia() {
  function visit(node: HastNode, linked: boolean) {
    const children: HastNode[] = []
    for (const child of node.children ?? []) {
      const swapped = replacement(child, linked)
      if (swapped) {
        children.push(swapped)
        continue
      }
      visit(child, linked || child.tagName === 'a')
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

export function GithubMedia({
  path = '',
  href = '',
  kind,
  alt,
  width,
  height,
  linked,
}: {
  path?: string
  href?: string
  kind?: string
  alt?: string
  width?: string
  height?: string
  linked?: string
}) {
  const openMedia = useOpenMedia()
  const thumbnail = useRef<HTMLButtonElement>(null)
  const [resolved, setResolved] = useState<MediaKind | 'failed' | undefined>(
    kind === 'image' || kind === 'video' ? kind : undefined
  )

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

  const attachment: Attachment = {
    id: path,
    name: alt ?? (resolved === 'video' ? 'Video' : 'Image'),
    mimeType: resolved === 'video' ? 'video/*' : 'image/*',
    sizeBytes: 0,
    ...(width && height ? { width: Number(width), height: Number(height) } : {}),
  }
  const failed = () => setResolved('failed')

  if (resolved === 'failed')
    return (
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='inline-flex w-fit items-center gap-2 rounded-lg bg-muted px-3 py-2 align-middle text-xs whitespace-nowrap text-muted-foreground no-underline transition-colors hover:text-foreground'
      >
        <ImageBrokenIcon className='size-4 shrink-0' />
        Couldn't load attachment · Open on GitHub
      </a>
    )
  if (!resolved) return <div className='aspect-video max-h-120 w-full rounded-lg bg-muted' />
  if (resolved === 'video') return <VideoPlayer video={attachment} onError={failed} />
  if (linked)
    return (
      <img
        src={path}
        alt={attachment.name}
        loading='lazy'
        decoding='async'
        className={cn('max-w-full rounded-lg', !attachment.width && 'max-h-120')}
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
