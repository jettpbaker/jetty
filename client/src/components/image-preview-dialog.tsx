import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export type ImagePreview = { url: string; name: string }

export function ImagePreviewDialog({
  preview,
  onClose,
}: {
  preview: ImagePreview | null
  onClose: () => void
}) {
  return (
    <Dialog open={preview !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className='w-auto max-w-[90vw] rounded-none bg-transparent p-0 ring-0 sm:max-w-[90vw]'
      >
        <DialogTitle className='sr-only'>{preview?.name}</DialogTitle>
        <img
          alt={preview?.name}
          src={preview?.url}
          className='max-h-[85vh] max-w-full rounded-lg object-contain'
        />
      </DialogContent>
    </Dialog>
  )
}
