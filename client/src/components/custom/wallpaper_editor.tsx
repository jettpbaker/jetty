import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { loadAppearance, saveAppearance, type Appearance } from '@/lib/appearance'
import {
  cropRect,
  defaultCrop,
  renderWallpaperCrop,
  resizeCrop,
  type CropHandle,
  type WallpaperCrop,
} from '@/lib/wallpaper-crop'
import { ArrowUUpLeftIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const handles = [
  ['nw', 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', 'nwse-resize'],
  ['n', 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', 'ns-resize'],
  ['ne', 'right-0 top-0 translate-x-1/2 -translate-y-1/2', 'nesw-resize'],
  ['e', 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', 'ew-resize'],
  ['se', 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', 'nwse-resize'],
  ['s', 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', 'ns-resize'],
  ['sw', 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', 'nesw-resize'],
  ['w', 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', 'ew-resize'],
] as const
function panelAspect() {
  const box = document.querySelector('[aria-label="Thread workspace"]')?.getBoundingClientRect()
  return box && box.height > 0 ? box.width / box.height : 16 / 9
}
const clamp = (value: number) => Math.max(0, Math.min(1, value))

export function WallpaperEditor({
  appearance,
  onClose,
}: {
  appearance: Appearance
  onClose: () => void
}) {
  const source = appearance.source ?? appearance.wallpaper
  const [crop, setCrop] = useState(
    () => appearance.crop ?? { ...defaultCrop, aspect: panelAspect() }
  )
  const current = useRef(crop)
  const frame = useRef<HTMLDivElement>(null)
  const selection = useRef<HTMLDivElement>(null)
  const [imageAspect, setImageAspect] = useState(16 / 9)
  const img = useRef<HTMLImageElement>(null)
  const drag = useRef<{
    id: number
    x: number
    y: number
    crop: WallpaperCrop
    handle?: CropHandle
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const stopDrag = useCallback(() => {
    const active = drag.current
    if (!active) return
    drag.current = null
    const node = selection.current
    if (node) {
      node.style.cursor = 'grab'
      if (node.hasPointerCapture(active.id)) node.releasePointerCapture(active.id)
    }
    setCrop(current.current)
  }, [])
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.id) stopDrag()
    }
    const visibility = () => {
      if (document.hidden) stopDrag()
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', stopDrag)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', stopDrag)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [stopDrag])
  function paint(next: WallpaperCrop) {
    current.current = next
    const node = img.current
    const box = frame.current
    if (!node?.naturalWidth || !box || !selection.current) return
    const rect = cropRect(node.naturalWidth, node.naturalHeight, next)
    const scale = box.clientWidth / node.naturalWidth
    selection.current.style.width = `${rect.width * scale}px`
    selection.current.style.height = `${rect.height * scale}px`
    selection.current.style.transform = `translate(${rect.x * scale}px, ${rect.y * scale}px)`
  }
  useLayoutEffect(() => {
    paint(crop)
    const observer = new ResizeObserver(() => paint(current.current))
    if (frame.current) observer.observe(frame.current)
    return () => observer.disconnect()
  }, [crop, imageAspect])
  async function save() {
    setSaving(true)
    setError('')
    try {
      const selected = current.current
      const wallpaper = await renderWallpaperCrop(source, selected)
      saveAppearance({ ...loadAppearance(), wallpaper, source, crop: selected })
      onClose()
    } catch {
      setError('Could not save the crop. Try a smaller image.')
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className='max-h-[90dvh] gap-3 overflow-y-auto rounded-md p-3 sm:max-w-3xl'
      >
        <DialogTitle className='sr-only'>Edit wallpaper</DialogTitle>
        <DialogDescription className='sr-only'>
          Drag inside to move. Drag an edge or corner to resize.
        </DialogDescription>
        <div className='flex justify-center'>
          <div
            ref={frame}
            className='relative overflow-hidden rounded-menu-item bg-muted'
            style={{ aspectRatio: imageAspect, width: `min(100%, ${60 * imageAspect}dvh)` }}
          >
            <img
              ref={img}
              src={source}
              alt='Original wallpaper'
              draggable={false}
              onLoad={() => {
                if (img.current)
                  setImageAspect(img.current.naturalWidth / img.current.naturalHeight)
                paint(current.current)
              }}
              className='pointer-events-none absolute inset-0 size-full select-none'
            />
            <div
              ref={selection}
              role='group'
              aria-label='Move crop frame with arrow keys or drag'
              tabIndex={0}
              className='absolute left-0 top-0 touch-none border border-white outline-none focus-visible:border-primary'
              style={{ cursor: 'grab', boxShadow: '0 0 0 9999px rgb(0 0 0 / 35%)' }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                const directions: Record<string, [number, number]> = {
                  ArrowLeft: [-0.02, 0],
                  ArrowRight: [0.02, 0],
                  ArrowUp: [0, -0.02],
                  ArrowDown: [0, 0.02],
                }
                const delta = directions[event.key]
                if (!delta) return
                event.preventDefault()
                setCrop({
                  ...current.current,
                  x: clamp(current.current.x + delta[0]),
                  y: clamp(current.current.y + delta[1]),
                })
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || drag.current) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                const handle = (event.target as HTMLElement).closest<HTMLElement>(
                  '[data-crop-handle]'
                )?.dataset.cropHandle as CropHandle | undefined
                event.currentTarget.style.cursor = handle
                  ? getComputedStyle(event.target as HTMLElement).cursor
                  : 'grabbing'
                drag.current = {
                  id: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  crop: current.current,
                  handle,
                }
              }}
              onPointerMove={(event) => {
                const start = drag.current
                const node = img.current
                const box = frame.current
                if (!start || start.id !== event.pointerId || !node?.naturalWidth || !box) return
                if ((event.buttons & 1) === 0) {
                  stopDrag()
                  return
                }
                const rect = cropRect(node.naturalWidth, node.naturalHeight, start.crop)
                const scale = box.clientWidth / node.naturalWidth
                if (start.handle) {
                  paint(
                    resizeCrop(
                      node.naturalWidth,
                      node.naturalHeight,
                      start.crop,
                      start.handle,
                      (event.clientX - start.x) / scale,
                      (event.clientY - start.y) / scale
                    )
                  )
                  return
                }
                const overflowX = (node.naturalWidth - rect.width) * scale
                const overflowY = (node.naturalHeight - rect.height) * scale
                paint({
                  ...start.crop,
                  x:
                    overflowX > 0
                      ? clamp(start.crop.x + (event.clientX - start.x) / overflowX)
                      : 0.5,
                  y:
                    overflowY > 0
                      ? clamp(start.crop.y + (event.clientY - start.y) / overflowY)
                      : 0.5,
                })
              }}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
              onLostPointerCapture={stopDrag}
            >
              {(['n', 's', 'e', 'w'] as const).map((edge) => (
                <span
                  key={edge}
                  data-crop-handle={edge}
                  aria-hidden='true'
                  className={`absolute ${edge === 'n' ? 'inset-x-0 top-0 h-3 -translate-y-1/2 cursor-ns-resize' : edge === 's' ? 'inset-x-0 bottom-0 h-3 translate-y-1/2 cursor-ns-resize' : edge === 'e' ? 'inset-y-0 right-0 w-3 translate-x-1/2 cursor-ew-resize' : 'inset-y-0 left-0 w-3 -translate-x-1/2 cursor-ew-resize'}`}
                />
              ))}
              {handles.map(([handle, position, cursor]) => (
                <button
                  key={handle}
                  type='button'
                  data-crop-handle={handle}
                  aria-label={`Resize crop ${handle}`}
                  className={`absolute z-10 flex size-6 touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary ${position}`}
                  style={{ cursor }}
                  onKeyDown={(event) => {
                    const delta: Record<string, [number, number]> = {
                      ArrowLeft: [-1, 0],
                      ArrowRight: [1, 0],
                      ArrowUp: [0, -1],
                      ArrowDown: [0, 1],
                    }
                    const d = delta[event.key]
                    const node = img.current
                    if (!d || !node) return
                    event.preventDefault()
                    event.stopPropagation()
                    const step = node.naturalWidth * (event.shiftKey ? 0.02 : 0.005)
                    setCrop(
                      resizeCrop(
                        node.naturalWidth,
                        node.naturalHeight,
                        current.current,
                        handle,
                        d[0] * step,
                        d[1] * step
                      )
                    )
                  }}
                />
              ))}
              <div
                aria-hidden='true'
                className='pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3'
              >
                {Array.from({ length: 9 }, (_, i) => (
                  <span key={i} className='border-[0.5px] border-white/10' />
                ))}
              </div>
            </div>
          </div>
        </div>
        {error && (
          <p role='alert' className='text-xs text-destructive'>
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant='ghost-text'
            size='sm'
            className='h-7 rounded-sm sm:mr-auto'
            onClick={() => setCrop({ ...defaultCrop, aspect: panelAspect() })}
            disabled={saving}
          >
            <ArrowUUpLeftIcon />
            Reset
          </Button>
          <Button
            variant='ghost-text'
            size='sm'
            className='h-7 rounded-sm'
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size='sm'
            className='h-7 rounded-sm'
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
