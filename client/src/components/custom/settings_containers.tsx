import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChrome } from '@/state'
import { useContainerStatus, useSetContainerLimits, useStopContainer } from '@/state/containers'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import './settings_sections.css'

export function SettingsContainers() {
  const { status, refresh } = useContainerStatus()
  const threads = useChrome()?.threads ?? []
  const setLimits = useSetContainerLimits()
  const stop = useStopContainer()
  const [max, setMaxInput] = useState('2')
  const [memory, setMemory] = useState('8')
  const [cpus, setCpus] = useState('2')
  const [saving, setSaving] = useState(false)
  const [stopping, setStopping] = useState<string>()
  const configuredMax = status?.maxRunning
  const configuredMemory = status?.memoryGiB
  const configuredCpus = status?.cpus
  useEffect(() => {
    if (configuredMax) setMaxInput(String(configuredMax))
    if (configuredMemory) setMemory(String(configuredMemory))
    if (configuredCpus) setCpus(String(configuredCpus))
  }, [configuredMax, configuredMemory, configuredCpus])
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])
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
          <span className='text-muted-foreground'>Usable memory</span>
          <p>
            {status.availableGiB === null ? 'Unavailable' : `${status.availableGiB.toFixed(1)} GiB`}
          </p>
        </div>
      </div>
      <div className='flex flex-wrap items-end gap-3'>
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
        <div className='flex flex-col gap-1 text-xs text-muted-foreground'>
          <label htmlFor='containers-memory'>Memory / container (GiB)</label>
          <Input
            id='containers-memory'
            type='number'
            min={1}
            step={1}
            value={memory}
            onChange={(event) => setMemory(event.target.value)}
            className='w-24'
          />
        </div>
        <div className='flex flex-col gap-1 text-xs text-muted-foreground'>
          <label htmlFor='containers-cpus'>CPUs / container</label>
          <Input
            id='containers-cpus'
            type='number'
            min={0.5}
            step={0.5}
            value={cpus}
            onChange={(event) => setCpus(event.target.value)}
            className='w-24'
          />
        </div>
        <Button
          size='sm'
          variant='outline'
          disabled={
            saving ||
            !Number.isInteger(Number(max)) ||
            Number(max) < 1 ||
            Number(max) > 32 ||
            !Number.isFinite(Number(memory)) ||
            Number(memory) < 1 ||
            !Number.isFinite(Number(cpus)) ||
            Number(cpus) <= 0
          }
          onClick={() => {
            setSaving(true)
            setLimits(
              { maxRunning: Number(max), memoryGiB: Number(memory), cpus: Number(cpus) },
              () => {
                setSaving(false)
                refresh()
              },
              (error) => {
                setSaving(false)
                toast.error(`Couldn't save container limits: ${String(error)}`)
              }
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
              <span className='flex shrink-0 items-center gap-2'>
                <span className='text-muted-foreground'>{entry.state}</span>
                {entry.state === 'running' && (
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={stopping === entry.threadId}
                    onClick={() => {
                      setStopping(entry.threadId)
                      stop(
                        entry.threadId,
                        () => {
                          setStopping(undefined)
                          refresh()
                        },
                        (error) => {
                          setStopping(undefined)
                          toast.error(`Couldn't stop container: ${String(error)}`)
                        }
                      )
                    }}
                  >
                    Stop
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
