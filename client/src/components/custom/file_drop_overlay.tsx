import { Attachment01Icon } from '@/components/custom/huge_icons'
import { canDropAttachments, dropAttachments } from '@/hooks/use-attachments'
import { useEffect, useState } from 'react'

function carriesFiles(event: DragEvent): event is DragEvent & { dataTransfer: DataTransfer } {
  return event.dataTransfer?.types.includes('Files') ?? false
}

// A dropped folder arrives as a file too; only its entry says it's a folder.
function dropped(transfer: DataTransfer) {
  const files: File[] = []
  let folders = 0
  for (const item of transfer.items) {
    if (item.kind !== 'file') continue
    if (item.webkitGetAsEntry()?.isDirectory) folders += 1
    else {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return { files, folders }
}

export function FileDropOverlay() {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0
    let stale: ReturnType<typeof setTimeout> | undefined

    function reset() {
      clearTimeout(stale)
      depth = 0
      setDragging(false)
    }

    function enter(event: DragEvent) {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth += 1
      if (depth === 1 && canDropAttachments()) setDragging(true)
    }

    function leave(event: DragEvent) {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }

    function over(event: DragEvent) {
      if (!carriesFiles(event)) return
      clearTimeout(stale)
      stale = setTimeout(reset, 1000)
      if (event.defaultPrevented) return
      event.preventDefault()
      event.dataTransfer.dropEffect = canDropAttachments() ? 'copy' : 'none'
    }

    function drop(event: DragEvent) {
      if (!carriesFiles(event)) return
      reset()
      if (event.defaultPrevented) return
      event.preventDefault()
      const { files, folders } = dropped(event.dataTransfer)
      dropAttachments(files, folders)
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('dragend', reset)
    return () => {
      clearTimeout(stale)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('dragend', reset)
    }
  }, [])

  if (!dragging) return null
  return (
    <div className='pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background/80 text-sm supports-backdrop-filter:backdrop-blur-xs'>
      <Attachment01Icon size={24} className='text-muted-foreground' />
      Drop files to attach
    </div>
  )
}
