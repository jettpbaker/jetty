import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { storage } from '@/platform'
import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'

import { FolderPickerBreadcrumb } from './project_folder_breadcrumb'
import { FolderPickerCompact } from './project_folder_compact'
import { useFolderPicker, type FolderPicker } from './project_folder_picker'
import { FolderPickerRaycast } from './project_folder_raycast'

// Temporary A/B/C switcher while Jett compares variations; delete with the losers.
const variants = {
  A: { label: 'Raycast', View: FolderPickerRaycast },
  B: { label: 'Compact', View: FolderPickerCompact },
  C: { label: 'Breadcrumb', View: FolderPickerBreadcrumb },
} satisfies Record<string, { label: string; View: (props: { picker: FolderPicker }) => unknown }>
type Variant = keyof typeof variants
const variantKey = 'jetty.projectPicker.variant'

function pickerInput() {
  return document.querySelector<HTMLElement>('[data-slot=folder-picker-input]')
}

function loadVariant(): Variant {
  const saved = storage.get(variantKey)
  return saved === 'A' || saved === 'B' || saved === 'C' ? saved : 'A'
}

export function ProjectFolderDialog({
  open,
  onOpenChange,
  existingPaths,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingPaths: readonly string[]
  onAdd: (path: string) => void
}) {
  const back = useRef<() => boolean>(() => false)
  const [variant, setVariant] = useState(loadVariant)

  function chooseVariant(next: Variant) {
    storage.set(variantKey, next)
    setVariant(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === 'escape-key' && back.current()) {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        className={cn(
          'top-[18%] translate-y-0 gap-0 rounded-xl p-0',
          variant === 'A' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        )}
        showCloseButton={false}
        initialFocus={pickerInput}
      >
        <DialogTitle className='sr-only'>New project</DialogTitle>
        <DialogDescription className='sr-only'>
          Browse folders and choose a project directory.
        </DialogDescription>
        <div
          role='radiogroup'
          aria-label='Picker variation'
          className='absolute right-0 bottom-full mb-2 flex gap-0.5 rounded-md bg-popover p-0.5 text-xs ring-1 ring-foreground/10'
        >
          {Object.entries(variants).map(([key, { label }]) => (
            <button
              key={key}
              type='button'
              role='radio'
              aria-checked={variant === key}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => chooseVariant(key as Variant)}
              className='rounded-sm px-2 py-0.5 text-muted-foreground hover:text-foreground aria-checked:bg-accent aria-checked:text-foreground'
            >
              {key} {label}
            </button>
          ))}
        </div>
        <PickerBody
          variant={variant}
          back={back}
          existingPaths={existingPaths}
          onAdd={(path) => {
            onAdd(path)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function PickerBody({
  variant,
  back,
  existingPaths,
  onAdd,
}: {
  variant: Variant
  back: RefObject<() => boolean>
  existingPaths: readonly string[]
  onAdd: (path: string) => void
}) {
  const picker = useFolderPicker(existingPaths, onAdd)
  useImperativeHandle(back, () => picker.back)
  useEffect(() => pickerInput()?.focus(), [variant])
  const { View } = variants[variant]
  return <View picker={picker} />
}
