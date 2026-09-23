import { canDropImages, dropImages, isImageType } from '@/hooks/use-image-attachments'
import { ImageIcon } from '@primer/octicons-react'
import { useEffect, useState } from 'react'

type DragState = 'images' | 'other'

function carriesFiles(event: DragEvent): event is DragEvent & { dataTransfer: DataTransfer } {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function dragState(transfer: DataTransfer): DragState {
  const types = [...transfer.items].flatMap((item) => (item.kind === 'file' ? [item.type] : []))
  return types.every((type) => type && !isImageType(type)) && types.length > 0 ? 'other' : 'images'
}

export function FileDropOverlay() {
  const [state, setState] = useState<DragState>()

  useEffect(() => {
    let depth = 0

    function reset() {
      depth = 0
      setState(undefined)
    }

    function enter(event: DragEvent) {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth += 1
      if (depth === 1 && canDropImages()) setState(dragState(event.dataTransfer))
    }

    function leave(event: DragEvent) {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setState(undefined)
    }

    function over(event: DragEvent) {
      if (!carriesFiles(event) || event.defaultPrevented) return
      event.preventDefault()
      event.dataTransfer.dropEffect = canDropImages() ? 'copy' : 'none'
    }

    function drop(event: DragEvent) {
      if (!carriesFiles(event)) return
      reset()
      if (event.defaultPrevented) return
      event.preventDefault()
      dropImages(event.dataTransfer.files)
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', reset)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', reset)
    }
  }, [])

  if (!state) return null
  return (
    <div className='pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background/80 text-sm supports-backdrop-filter:backdrop-blur-xs'>
      <ImageIcon size={24} className='text-muted-foreground' />
      {state === 'images' ? 'Drop images to attach' : 'Images only'}
    </div>
  )
}
