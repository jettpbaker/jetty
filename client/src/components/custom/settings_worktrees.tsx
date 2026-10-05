import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChrome } from '@/state'
import { useSetBranchPrefix } from '@/state/worktrees'
import { useId, useState } from 'react'

import './settings_sections.css'

export function SettingsWorktrees() {
  const prefix = useChrome()?.branchPrefix ?? 'jetty'
  const [draft, setDraft] = useState<string>()
  const save = useSetBranchPrefix()
  const id = useId()
  return (
    <div className='appearance-option-row'>
      <label htmlFor={id}>Branch prefix</label>
      <div className='flex items-center gap-2'>
        <Input
          id={id}
          className='h-7 w-40'
          value={draft ?? prefix}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          variant='outline'
          size='sm'
          disabled={draft === undefined || draft === prefix}
          onClick={() => save(draft ?? prefix, () => setDraft(undefined))}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
