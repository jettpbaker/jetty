import type { BranchList } from '@/state/worktrees'
import type { Branch } from '@jetty/shared/wire'

import { GitBranchIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { DisabledTooltip } from './disabled_tooltip'
import { OptionPicker, type PickerOption } from './option_picker'

type Branches = Extract<BranchList, { git: 'ok' }>

const onOrigin = (list: Branches) => list.branches.some((branch) => branch.origin)

function startRef(branch: Branch, fromOrigin: boolean) {
  return branch.origin && (fromOrigin || !branch.local) ? `origin/${branch.name}` : branch.name
}

// Current, default, newest commit first, then branches only origin has. Starting from origin,
// each branch is one row on the copy it would start from; otherwise each copy is its own row.
function baseRefs(list: Branches, fromOrigin: boolean): PickerOption[] {
  const defaultName = list.defaultRef.replace(/^origin\//, '')
  const origin = onOrigin(list)
  const rank = (branch: Branch) =>
    branch.name === list.currentBranch ? 0 : branch.name === defaultName ? 1 : branch.local ? 2 : 3
  const rows: PickerOption[] = []
  for (const branch of list.branches.toSorted((a, b) => rank(a) - rank(b))) {
    const hint =
      branch.name === list.currentBranch
        ? 'current'
        : branch.name === defaultName
          ? 'default'
          : branch.worktree
            ? 'worktree'
            : !branch.local
              ? 'remote'
              : origin && !branch.origin
                ? 'local'
                : undefined
    if (fromOrigin) {
      rows.push({ value: startRef(branch, true), label: branch.name, hint })
      continue
    }
    if (branch.local) rows.push({ value: branch.name, label: branch.name, hint })
    const copy = `origin/${branch.name}`
    if (branch.origin)
      rows.push({ value: copy, label: copy, hint: branch.local ? undefined : hint })
  }
  return rows
}

// The same branch under the other origin choice, or the default branch if it's gone.
export function switchRef(list: Branches, ref: string, fromOrigin: boolean) {
  const named = (name: string) =>
    list.branches.find((branch) => branch.name === name.replace(/^origin\//, ''))
  const branch = named(ref) ?? named(list.defaultRef)
  return branch ? startRef(branch, fromOrigin) : list.defaultRef
}

// A pick the list still offers stays; otherwise it becomes the same branch, or the default.
export function settleRef(list: Branches, ref: string | undefined, fromOrigin: boolean) {
  if (ref && baseRefs(list, fromOrigin).some((row) => row.value === ref)) return ref
  return switchRef(list, ref ?? list.defaultRef, fromOrigin)
}

export function ComposerBranch({
  branch,
  list,
  fromOrigin,
  onFromOriginChange,
  disabledReason,
  onChange,
  onOpen,
}: {
  branch?: string
  list?: Branches
  fromOrigin: boolean
  onFromOriginChange: (fromOrigin: boolean) => void
  disabledReason?: string
  onChange?: (ref: string) => void
  onOpen?: () => void
}) {
  // Without a branch or a problem to show, the list is still loading.
  if (!onChange || disabledReason)
    return (
      <DisabledTooltip reason={disabledReason} wrap='flex'>
        <Button
          variant='ghost-text'
          size='sm'
          className={cn('gap-1.5 rounded-sm', !branch && !disabledReason && 'invisible')}
          disabled
        >
          <GitBranchIcon />
          {branch || (disabledReason && 'Branch')}
        </Button>
      </DisabledTooltip>
    )
  return (
    <OptionPicker
      name='From'
      label='Choose base ref'
      placeholder='Search branches'
      align='end'
      className='w-64'
      icon={<GitBranchIcon />}
      value={branch ?? ''}
      valueLabel={fromOrigin ? branch?.replace(/^origin\//, '') : branch}
      options={list ? baseRefs(list, fromOrigin) : []}
      toggle={
        list && onOrigin(list)
          ? { label: 'Start from origin', checked: fromOrigin, onCheckedChange: onFromOriginChange }
          : undefined
      }
      onValueChange={onChange}
      onOpen={onOpen}
    />
  )
}
