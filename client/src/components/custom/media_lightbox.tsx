import type { Attachment } from '@jetty/shared/items'

import { mediaUrl } from '@/components/custom/media_layout'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pressProps } from '@/lib/press'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import {
  CaretLeft,
  CaretRight,
  Check,
  Copy,
  DownloadSimple,
  LinkSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  X,
} from '@phosphor-icons/react'
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useIsPresent,
  useReducedMotion,
  type MotionValue,
} from 'motion/react'
import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type MediaGroup = {
  items: readonly Attachment[]
  index: number
  // The on-screen thumbnail for an item, so the lightbox can grow out of it and shrink back.
  origin: (index: number) => HTMLElement | null
}

const OpenMedia = createContext<(group: MediaGroup) => void>(() => {})

export function useOpenMedia() {
  return use(OpenMedia)
}

export function MediaLightboxProvider({ children }: { children: ReactNode }) {
  const [group, setGroup] = useState<MediaGroup | null>(null)
  return (
    <OpenMedia value={setGroup}>
      {children}
      <MediaLightbox
        group={group}
        onIndexChange={(index) => setGroup((current) => current && { ...current, index })}
        onClose={() => setGroup(null)}
      />
    </OpenMedia>
  )
}

const inset = 64
const ease = [0.32, 0.72, 0, 1] as const
const openTransition = { duration: 0.3, ease }
const closeTransition = { duration: 0.22, ease }
const zoomTransition = { duration: 0.2, ease }
const thumbnailRadius = 8

type Size = { width: number; height: number }
type Box = Size & { scale: number }

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight }
}

function naturalSize(attachment: Attachment, origin: HTMLElement | null): Size {
  if (attachment.width && attachment.height)
    return { width: attachment.width, height: attachment.height }
  const media = origin?.querySelector('img, video') ?? origin
  if (media instanceof HTMLImageElement && media.naturalWidth)
    return { width: media.naturalWidth, height: media.naturalHeight }
  if (media instanceof HTMLVideoElement && media.videoWidth)
    return { width: media.videoWidth, height: media.videoHeight }
  return { width: 1280, height: 720 }
}

// Images never upscale past their pixels; a video fills the stage.
function fitBox(natural: Size, viewport: Size, video: boolean): Box {
  const fit = Math.min(
    (viewport.width - inset * 2) / natural.width,
    (viewport.height - inset * 2) / natural.height
  )
  const scale = video ? fit : Math.min(1, fit)
  return { width: natural.width * scale, height: natural.height * scale, scale }
}

function fromOrigin(origin: HTMLElement | null, box: Box, viewport: Size) {
  const rect = origin?.isConnected ? origin.getBoundingClientRect() : undefined
  if (
    !rect ||
    rect.width === 0 ||
    rect.bottom < 0 ||
    rect.top > viewport.height ||
    rect.right < 0 ||
    rect.left > viewport.width
  )
    return { frame: { opacity: 0, x: 0, y: 0, scale: 0.96 }, clipPath: fullFrame }
  const scale = Math.max(rect.width / box.width, rect.height / box.height)
  return {
    frame: {
      opacity: 1,
      x: rect.left + rect.width / 2 - viewport.width / 2,
      y: rect.top + rect.height / 2 - viewport.height / 2,
      scale,
    },
    // Crops back to the thumbnail's object-cover frame, on the media so zoom scales the crop too.
    clipPath: clip(
      (box.height - rect.height / scale) / 2,
      (box.width - rect.width / scale) / 2,
      thumbnailRadius / scale
    ),
  }
}

const fullFrame = clip(0, 0, 0)

function clip(vertical: number, horizontal: number, radius: number) {
  return `inset(${vertical}px ${horizontal}px ${vertical}px ${horizontal}px round ${radius}px)`
}

function isVideo(attachment: Attachment) {
  return attachment.mimeType.startsWith('video/')
}

function MediaLightbox({
  group,
  onIndexChange,
  onClose,
}: {
  group: MediaGroup | null
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  return (
    <Dialog open={group !== null} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {group && (
          <Lightbox key='lightbox' group={group} onIndexChange={onIndexChange} onClose={onClose} />
        )}
      </AnimatePresence>
    </Dialog>
  )
}

function useZoom(box: Box, viewport: Size) {
  const scale = useMotionValue(1)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const [zoomed, setZoomed] = useState(false)
  // Past 1 the image shows more pixels than it has; stop at 4 of those.
  const maxScale = Math.max(4, 4 / box.scale)

  function clamp(value: number, size: number, limit: number, zoom: number) {
    // Pans until an edge reaches the stage inset, never further.
    const slack = Math.max(0, (size * zoom - (limit - inset * 2)) / 2)
    return Math.min(slack, Math.max(-slack, value))
  }

  function set(values: { scale: number; x: number; y: number }, smooth: boolean) {
    const next = Math.min(maxScale, Math.max(1, values.scale))
    const nextX = clamp(values.x, box.width, viewport.width, next)
    const nextY = clamp(values.y, box.height, viewport.height, next)
    setZoomed(next > 1.001)
    if (!smooth) {
      scale.set(next)
      x.set(nextX)
      y.set(nextY)
      return
    }
    void animate(scale, next, zoomTransition)
    void animate(x, nextX, zoomTransition)
    void animate(y, nextY, zoomTransition)
  }

  // Keeps the point under the cursor fixed while the scale changes.
  function zoomTo(target: number, point = { x: 0, y: 0 }, smooth = true) {
    const current = scale.get()
    const next = Math.min(maxScale, Math.max(1, target))
    const ratio = next / current
    set(
      {
        scale: next,
        x: point.x - (point.x - x.get()) * ratio,
        y: point.y - (point.y - y.get()) * ratio,
      },
      smooth
    )
  }

  function panBy(dx: number, dy: number) {
    set({ scale: scale.get(), x: x.get() + dx, y: y.get() + dy }, false)
  }

  function toggle(point: { x: number; y: number }) {
    if (scale.get() > 1.001) return set({ scale: 1, x: 0, y: 0 }, true)
    const actual = 1 / box.scale
    zoomTo(actual > 1.25 ? actual : 2, point)
  }

  return {
    scale,
    x,
    y,
    zoomed,
    zoomTo,
    panBy,
    toggle,
    reset: (smooth = true) => set({ scale: 1, x: 0, y: 0 }, smooth),
  }
}

function Lightbox({
  group,
  onIndexChange,
  onClose,
}: {
  group: MediaGroup
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const { items, index, origin } = group
  const attachment = items[index]!
  const video = isVideo(attachment)
  const src = mediaUrl(attachment)
  const reducedMotion = useReducedMotion()
  const [viewport, setViewport] = useState(viewportSize)
  const [natural, setNatural] = useState(() => naturalSize(attachment, origin(index)))
  const box = fitBox(natural, viewport, video)
  const zoom = useZoom(box, viewport)
  const stage = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    const onResize = () => setViewport(viewportSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function show(next: number) {
    if (next < 0 || next >= items.length || next === index) return
    zoom.reset(false)
    setNatural(naturalSize(items[next]!, origin(next)))
    onIndexChange(next)
  }

  function stagePoint(clientX: number, clientY: number) {
    return { x: clientX - viewport.width / 2, y: clientY - viewport.height / 2 }
  }

  const isPresent = useIsPresent()
  const unzoom = useEffectEvent(() => zoom.reset())
  useEffect(() => {
    if (!isPresent) unzoom()
  }, [isPresent])

  const gestureBase = useRef(1)
  // Re-subscribes every render so the handlers always see the current box.
  useEffect(() => {
    const element = stage.current
    if (!element || video) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      // Trackpad pinch arrives as a ctrl+wheel in Chromium and Firefox.
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.01))
        zoom.zoomTo(zoom.scale.get() * factor, stagePoint(event.clientX, event.clientY), false)
      } else if (zoom.scale.get() > 1.001) {
        zoom.panBy(-event.deltaX, -event.deltaY)
      }
    }
    // Safari reports pinch as its own gesture events instead.
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureBase.current = zoom.scale.get()
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gesture = event as Event & { scale: number; clientX: number; clientY: number }
      zoom.zoomTo(
        gestureBase.current * gesture.scale,
        stagePoint(gesture.clientX, gesture.clientY),
        false
      )
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('gesturestart', onGestureStart)
    element.addEventListener('gesturechange', onGestureChange)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
    }
  })

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'ArrowLeft' && items.length > 1) show(index - 1)
    else if (event.key === 'ArrowRight' && items.length > 1) show(index + 1)
    else if (video) return
    else if (event.key === '+' || event.key === '=') zoom.zoomTo(zoom.scale.get() * 1.5)
    else if (event.key === '-' || event.key === '_') zoom.zoomTo(zoom.scale.get() / 1.5)
    else if (event.key === '0') zoom.reset()
    else return
    event.preventDefault()
  }

  const transition = reducedMotion ? { duration: 0.15 } : openTransition
  // Functions, so the close measures the thumbnail where it is now.
  const origins = () =>
    reducedMotion
      ? { frame: { opacity: 0 }, clipPath: fullFrame }
      : fromOrigin(origin(index), box, viewportSize())
  const exitTransition = reducedMotion ? transition : closeTransition
  const frame = {
    hidden: () => ({ ...origins().frame, transition: exitTransition }),
    shown: { opacity: 1, x: 0, y: 0, scale: 1 },
  }
  const crop = {
    hidden: () => ({ clipPath: origins().clipPath, transition: exitTransition }),
    shown: { clipPath: fullFrame },
  }

  return (
    <DialogPrimitive.Portal keepMounted>
      <DialogPrimitive.Backdrop
        render={
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: exitTransition }}
            transition={transition}
          />
        }
        className='fixed inset-0 z-50 bg-black/75 supports-backdrop-filter:backdrop-blur-md'
      />
      <DialogPrimitive.Popup
        ref={popup}
        className='fixed inset-0 z-50 outline-none'
        initialFocus={video ? videoRef : popup}
        onKeyDown={onKeyDown}
      >
        <DialogPrimitive.Title className='sr-only'>{attachment.name}</DialogPrimitive.Title>
        <div
          ref={stage}
          role='presentation'
          className='absolute inset-0 touch-none overflow-hidden'
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            className='absolute'
            style={{
              left: (viewport.width - box.width) / 2,
              top: (viewport.height - box.height) / 2,
              width: box.width,
              height: box.height,
            }}
            variants={frame}
            initial='hidden'
            animate='shown'
            exit='hidden'
            transition={transition}
          >
            <ZoomLayer zoom={zoom}>
              {video ? (
                // oxlint-disable-next-line jsx-a11y/media-has-caption -- agent screen recordings have no caption track
                <motion.video
                  ref={videoRef}
                  variants={crop}
                  transition={transition}
                  src={src}
                  controls
                  autoPlay
                  playsInline
                  className='size-full bg-black'
                  onLoadedMetadata={({ currentTarget }) => {
                    if (currentTarget.videoWidth && !attachment.width)
                      setNatural({
                        width: currentTarget.videoWidth,
                        height: currentTarget.videoHeight,
                      })
                  }}
                />
              ) : (
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- drag-to-pan and double-click zoom; the keyboard zooms with + - 0
                <motion.img
                  variants={crop}
                  transition={transition}
                  src={src}
                  alt={attachment.name}
                  draggable={false}
                  className='size-full select-none'
                  style={{ cursor: zoom.zoomed ? 'grab' : undefined }}
                  onLoad={({ currentTarget }) => {
                    const { naturalWidth: width, naturalHeight: height } = currentTarget
                    if (width !== natural.width || height !== natural.height)
                      setNatural({ width, height })
                  }}
                  onDoubleClick={(event) => zoom.toggle(stagePoint(event.clientX, event.clientY))}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    drag.current = {
                      id: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                    }
                    if (zoom.zoomed) event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const current = drag.current
                    if (!current || current.id !== event.pointerId || !zoom.zoomed) return
                    const dx = event.clientX - current.x
                    const dy = event.clientY - current.y
                    if (!current.moved && Math.hypot(dx, dy) < 3) return
                    current.moved = true
                    current.x = event.clientX
                    current.y = event.clientY
                    event.currentTarget.style.cursor = 'grabbing'
                    zoom.panBy(dx, dy)
                  }}
                  onPointerUp={(event) => {
                    event.currentTarget.style.cursor = ''
                    if (drag.current?.id === event.pointerId) drag.current = null
                  }}
                />
              )}
            </ZoomLayer>
          </motion.div>
        </div>
        {items.length > 1 && (
          <>
            <div className='pointer-events-none fixed top-4 left-4 text-sm text-muted-foreground tabular-nums'>
              {index + 1} / {items.length}
            </div>
            <StepButton side='left' disabled={index === 0} onPress={() => show(index - 1)} />
            <StepButton
              side='right'
              disabled={index === items.length - 1}
              onPress={() => show(index + 1)}
            />
          </>
        )}
        <Toolbar attachment={attachment} src={src} video={video} zoom={zoom} onClose={onClose} />
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function ZoomLayer({
  zoom,
  children,
}: {
  zoom: { scale: MotionValue<number>; x: MotionValue<number>; y: MotionValue<number> }
  children: ReactNode
}) {
  return (
    <motion.div className='size-full' style={{ scale: zoom.scale, x: zoom.x, y: zoom.y }}>
      {children}
    </motion.div>
  )
}

function StepButton({
  side,
  disabled,
  onPress,
}: {
  side: 'left' | 'right'
  disabled: boolean
  onPress: () => void
}) {
  const label = side === 'left' ? 'Previous image' : 'Next image'
  return (
    <Button
      variant='ghost'
      size='icon-lg'
      aria-label={label}
      disabled={disabled}
      className={`fixed top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-3' : 'right-3'}`}
      {...pressProps(onPress)}
    >
      {side === 'left' ? <CaretLeft /> : <CaretRight />}
    </Button>
  )
}

async function pngBlob(src: string) {
  const blob = await (await fetch(src)).blob()
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    bitmap.close()
  }
}

function download(src: string, name: string) {
  const link = document.createElement('a')
  link.href = src
  link.download = name
  link.click()
}

function Toolbar({
  attachment,
  src,
  video,
  zoom,
  onClose,
}: {
  attachment: Attachment
  src: string
  video: boolean
  zoom: ReturnType<typeof useZoom>
  onClose: () => void
}) {
  const [done, setDone] = useState<'image' | 'link' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function copied(kind: 'image' | 'link') {
    setDone(kind)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(null), 1500)
  }

  function copyImage() {
    // A pending promise keeps Safari's user-activation window open while the bytes load.
    void navigator.clipboard
      .write([new ClipboardItem({ 'image/png': pngBlob(src) })])
      .then(() => copied('image'))
  }

  function copyLink() {
    void navigator.clipboard
      .writeText(new URL(src, document.baseURI).href)
      .then(() => copied('link'))
  }

  return (
    <div className='fixed top-3 right-3 flex items-center gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10'>
      {!video && (
        <>
          <ToolbarButton
            label='Zoom out'
            shortcut='−'
            disabled={!zoom.zoomed}
            onPress={() => zoom.zoomTo(zoom.scale.get() / 1.5)}
          >
            <MagnifyingGlassMinus />
          </ToolbarButton>
          <ToolbarButton
            label='Zoom in'
            shortcut='+'
            onPress={() => zoom.zoomTo(zoom.scale.get() * 1.5)}
          >
            <MagnifyingGlassPlus />
          </ToolbarButton>
          <ToolbarButton label={done === 'image' ? 'Copied' : 'Copy image'} onPress={copyImage}>
            {done === 'image' ? <Check /> : <Copy />}
          </ToolbarButton>
        </>
      )}
      <ToolbarButton label='Download' onPress={() => download(src, attachment.name)}>
        <DownloadSimple />
      </ToolbarButton>
      {!src.startsWith('blob:') && (
        <ToolbarButton label={done === 'link' ? 'Copied' : 'Copy link'} onPress={copyLink}>
          {done === 'link' ? <Check /> : <LinkSimple />}
        </ToolbarButton>
      )}
      <ToolbarButton label='Close' shortcut='Esc' onPress={onClose}>
        <X />
      </ToolbarButton>
    </div>
  )
}

function ToolbarButton({
  label,
  shortcut,
  disabled,
  onPress,
  children,
}: {
  label: string
  shortcut?: string
  disabled?: boolean
  onPress: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            aria-label={label}
            disabled={disabled}
            {...pressProps(onPress)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side='bottom'>
        {label}
        {shortcut ? <span className='text-muted-foreground'>{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
