import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { pressProps } from '@/lib/press'
import { useChrome } from '@/state'
import { useSetBranchPrefix } from '@/state/worktrees'
import { useState } from 'react'

export function SettingsWorktrees() {
  const prefix = useChrome()?.branchPrefix ?? 'jetty'
  const [draft, setDraft] = useState<string>()
  const save = useSetBranchPrefix()
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor='branch-prefix'>Branch prefix</FieldLabel>
        <Input
          id='branch-prefix'
          value={draft ?? prefix}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          variant='outline'
          disabled={draft === undefined || draft === prefix}
          {...pressProps(() => save(draft ?? prefix, () => setDraft(undefined)))}
        >
          Save
        </Button>
      </Field>
    </FieldGroup>
  )
}
