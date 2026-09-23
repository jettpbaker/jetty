import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChrome } from '@/state'
import { useContainerStatus, useSetContainerMax } from '@/state/containers'
import { useEffect, useState } from 'react'

import './settings_sections.css'

export function SettingsContainers() {
  const { status, refresh } = useContainerStatus()
  const threads = useChrome()?.threads ?? []
  const setMax = useSetContainerMax()
  const [max, setMaxInput] = useState('2')
  const [saving, setSaving] = useState(false)
  const configuredMax = status?.maxRunning
  useEffect(() => {
    if (configuredMax) setMaxInput(String(configuredMax))
  }, [configuredMax])
  if (!status) return <p className='text-xs text-muted-foreground'>Checking…</p>
  if (!status.enabled)
    return <p className='text-xs text-muted-foreground'>Disabled · JETTY_CONTAINERS=1</p>
  return (
    <div className='flex flex-col gap-4 text-13'>
      <div className='flex flex-wrap gap-x-8 gap-y-3 border-b border-border pb-4 text-xs'>
        <div>
          <span className='text-muted-foreground'>Docker</span>
          <p>{status.docker ? 'Ready' : 'Unavailable'}</p>
        </div>
        <div>
          <span className='text-muted-foreground'>Running</span>
          <p>{status.running}</p>
        </div>
        <div>
          <span className='text-muted-foreground'>CPU / container</span>
          <p>{status.cpus}</p>
        </div>
        <div>
          <span className='text-muted-foreground'>Memory / container</span>
          <p>{status.memoryGiB} GiB</p>
        </div>
      </div>
      <div className='flex items-end gap-2'>
        <div className='flex flex-col gap-1 text-xs text-muted-foreground'>
          <label htmlFor='containers-max'>Max running containers</label>
          <Input
            id='containers-max'
            type='number'
            min={1}
            max={32}
            value={max}
            onChange={(event) => setMaxInput(event.target.value)}
            className='w-24'
          />
        </div>
        <Button
          size='sm'
          variant='outline'
          disabled={saving || !Number.isInteger(Number(max)) || Number(max) < 1}
          onClick={() => {
            setSaving(true)
            setMax(
              Number(max),
              () => {
                setSaving(false)
                refresh()
              },
              () => setSaving(false)
            )
          }}
        >
          Save
        </Button>
      </div>
      <div className='flex flex-wrap gap-x-8 gap-y-3 border-b border-border pb-4 text-xs'>
        <div>
          <span className='text-muted-foreground'>Codex auth</span>
          <p>{status.credentials.codex ? 'Ready' : 'Needed'}</p>
        </div>
        <div>
          <span className='text-muted-foreground'>Claude token</span>
          <p>{status.credentials.claude ? 'Ready' : 'Needed'}</p>
        </div>
        <div>
          <span className='text-muted-foreground'>Grok key</span>
          <p>{status.credentials.grok ? 'Ready' : 'Needed'}</p>
        </div>
      </div>
      {status.retained.length > 0 && (
        <div className='flex flex-col gap-2'>
          <h3 className='text-xs text-muted-foreground'>Retained environments</h3>
          {status.retained.map((entry) => (
            <div
              key={entry.threadId}
              className='flex justify-between gap-2 border-b border-border pb-2 text-xs'
            >
              <span className='truncate' title={entry.checkoutPath}>
                {threads.find((thread) => thread.id === entry.threadId)?.title ?? entry.threadId}
              </span>
              <span className='shrink-0 text-muted-foreground'>{entry.state}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
