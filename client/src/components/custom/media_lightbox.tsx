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

type Size = { width: number; height: number }
type Box = Size & { scale: number }

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight }
}

function naturalSize(attachment: Attachment, origin: HTMLElement | null): Size {
  if (attachment.width && attachment.height)
    return { width: attachment.width, height: attachment.height }
  const image = origin?.querySelector('img')
  if (image?.naturalWidth) return { width: image.naturalWidth, height: image.naturalHeight }
  return { width: 1280, height: 720 }
}

// Never upscales past the image's own pixels.
function fitBox(natural: Size, viewport: Size): Box {
  const scale = Math.min(
    1,
    (viewport.width - inset * 2) / natural.width,
    (viewport.height - inset * 2) / natural.height
  )
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
  const radius = parseFloat(getComputedStyle(origin!).borderTopLeftRadius) || 0
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
      radius / scale
    ),
  }
}

const fullFrame = clip(0, 0, 0)

function clip(vertical: number, horizontal: number, radius: number) {
  return `inset(${vertical}px ${horizontal}px ${vertical}px ${horizontal}px round ${radius}px)`
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
  const src = mediaUrl(attachment)
  const reducedMotion = useReducedMotion()
  const [viewport, setViewport] = useState(viewportSize)
  const [natural, setNatural] = useState(() => naturalSize(attachment, origin(index)))
  const box = fitBox(natural, viewport)
  const zoom = useZoom(box, viewport)
  const stage = useRef<HTMLDivElement>(null)
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
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      // Trackpad pinch arrives as a ctrl+wheel in Chromium and Firefox.
      if (event.ctrlKey || event.metaKey) {
        // A mouse-wheel notch is ~100px; capped so it steps like a pinch instead of jumping ~2.7×.
        const delta = event.deltaY * (event.deltaMode === 1 ? 5 : 1)
        const factor = Math.exp(-Math.max(-20, Math.min(20, delta)) * 0.01)
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
        initialFocus={popup}
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
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- drag-to-pan and double-click zoom; the keyboard zooms with + - 0 */}
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
        <Toolbar src={src} zoom={zoom} onClose={onClose} />
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

function Toolbar({
  src,
  zoom,
  onClose,
}: {
  src: string
  zoom: ReturnType<typeof useZoom>
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function copyImage() {
    // A pending promise keeps Safari's user-activation window open while the bytes load.
    void navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(src) })]).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className='fixed top-3 right-3 flex items-center gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10'>
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
      <ToolbarButton label={copied ? 'Copied' : 'Copy image'} onPress={copyImage}>
        {copied ? <Check /> : <Copy />}
      </ToolbarButton>
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
