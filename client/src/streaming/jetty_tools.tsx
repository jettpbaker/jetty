import type { ProviderModel } from '@jetty/shared/wire'

import { ActivityChevron } from '@/components/custom/activity_disclosure'
import { CheckListIcon, Refresh01Icon } from '@/components/custom/huge_icons'
import { GitPullRequestIcon } from '@/components/custom/lucide_icons'
import { ModelLabel } from '@/components/custom/model_label'
import { ProjectGlyph } from '@/components/custom/project_glyph'
import { ProviderGlyph } from '@/components/custom/provider_glyph'
import { RollingNumber } from '@/components/custom/rolling_number'
import { StatusGlyph, threadStatus } from '@/components/custom/thread_status'
import { ToolCallDetails } from '@/components/custom/tool_call'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { loadAccent } from '@/lib/accent'
import { pressProps } from '@/lib/press'
import { applyTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import { modelResults, threadResults } from './jetty_tool_fixtures'
import '../index.css'
import '../accent.css'
import '@/components/custom/work.css'

type ResultState = 'complete' | 'loading' | 'empty' | 'failed'
type ThreadResult = (typeof threadResults)[number]
type ModelResult = (typeof modelResults)[number]
const resultStates: ResultState[] = ['complete', 'loading', 'empty', 'failed']

function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant='ghost-text' />} className='activity-header'>
        <span>{title}</span>
        <ActivityChevron />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

function RawResult({
  name,
  output,
  failed = false,
}: {
  name: string
  output: unknown
  failed?: boolean
}) {
  return (
    <ToolCallDetails
      call={{
        type: 'tool',
        id: name,
        kind: 'generic',
        name,
        target: '',
        status: failed ? 'failed' : 'complete',
        input: '{}',
        output: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
      }}
    />
  )
}

function ModelRow({ result }: { result: ModelResult }) {
  const model: ProviderModel = { ...result, fast: false, autoMode: false }
  return (
    <Disclosure
      title={
        <span className='inline-flex items-center gap-1.5 text-foreground'>
          <ProviderGlyph provider={model.provider} className='size-3 text-muted-foreground' />
          <ModelLabel model={model} />
        </span>
      }
    >
      <div className='flex flex-col gap-1 py-1 pl-2 text-xs text-muted-foreground'>
        <p className='font-mono'>{model.id}</p>
        <p>Effort: {model.efforts.join(' · ')}</p>
        {model.defaultEffort && <p>Default: {model.defaultEffort}</p>}
        {'notes' in result && <p className='max-w-sm leading-relaxed'>{result.notes}</p>}
      </div>
    </Disclosure>
  )
}

function ThreadRow({
  result,
  onSelect,
}: {
  result: ThreadResult
  onSelect: (result: ThreadResult) => void
}) {
  return (
    <div className='activity-header activity-file-row'>
      <Button
        variant='link'
        size='sm'
        className='min-w-0 shrink justify-start gap-1.5 px-0 text-13 font-normal'
        title={`${result.title} · ${result.project}`}
        onClick={() => onSelect(result)}
      >
        <StatusGlyph status={threadStatus(result.status)} className='size-3.25' />
        <span className='truncate'>{result.title}</span>
      </Button>
      <span className='shrink-0 text-xs text-muted-foreground'>{result.project}</span>
    </div>
  )
}

function ListingExample({
  kind,
  onSelect,
}: {
  kind: 'models' | 'threads'
  onSelect: (result: ThreadResult) => void
}) {
  const [state, setState] = useState<ResultState>('complete')
  const [replay, setReplay] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState(true)
  const results = kind === 'models' ? modelResults : threadResults
  const name = `list_${kind}`
  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => {
      setState('complete')
      setPlaying(false)
    }, 1200)
    return () => clearTimeout(timer)
  }, [replay, playing])

  function play() {
    setState('loading')
    setOpen(true)
    setPlaying(true)
    setReplay((value) => value + 1)
  }

  return (
    <section aria-label={`${kind} results`} className='min-w-0'>
      <div className='mb-3 flex items-center justify-between gap-4'>
        <h2 className='text-sm font-medium capitalize'>{kind}</h2>
        <Button variant='ghost' size='sm' {...pressProps(play)}>
          <Refresh01Icon data-icon='inline-start' /> Replay
        </Button>
      </div>
      <ToggleGroup
        size='sm'
        value={[state]}
        aria-label={`${kind} result state`}
        onValueChange={(values) => {
          const next = resultStates.find((value) => value === values[0])
          if (!next) return
          setPlaying(false)
          setState(next)
          setOpen(true)
        }}
      >
        {resultStates.map((value) => (
          <ToggleGroupItem key={value} value={value} className='capitalize'>
            {value === 'complete' ? 'Results' : value}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className='work-scroll mt-8 min-h-64' data-listing={kind}>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger render={<Button variant='ghost-text' />} className='activity-header'>
            <span className='flex items-baseline gap-1'>
              <span className={cn(state === 'loading' && 'shimmer')}>
                {state === 'loading' ? 'Listing' : state === 'failed' ? 'Failed to list' : 'Listed'}
              </span>
              {state === 'complete' || state === 'empty' ? (
                <RollingNumber
                  value={state === 'empty' ? 0 : results.length}
                  className='font-mono'
                />
              ) : null}
              {kind}
            </span>
            <ActivityChevron />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {state === 'complete' ? (
              <div key={replay} className='work-raise-enter pl-2'>
                {kind === 'models'
                  ? modelResults.map((model) => <ModelRow key={model.id} result={model} />)
                  : threadResults.map((thread) => (
                      <ThreadRow key={thread.id} result={thread} onSelect={onSelect} />
                    ))}
                <Disclosure title='Tool details'>
                  <RawResult name={name} output={results} />
                </Disclosure>
              </div>
            ) : state === 'failed' ? (
              <RawResult
                name={name}
                failed
                output='The Jetty connection closed before the result arrived.'
              />
            ) : state === 'empty' ? (
              <p className='py-1 pl-2 text-13 leading-5 text-muted-foreground'>
                No {kind} returned.
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </section>
  )
}

function ThreadPreview({ result }: { result: ThreadResult }) {
  return (
    <section aria-label='Thread preview' className='min-w-0'>
      <h2 className='mb-4 text-sm font-medium'>Thread link preview</h2>
      <div className='flex items-center gap-1.5 text-13'>
        <StatusGlyph status={threadStatus(result.status)} className='size-3.25' />
        <span>{result.title}</span>
      </div>
      <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground'>
        <span className='inline-flex items-center gap-1'>
          <ProjectGlyph className='size-3' /> {result.project}
        </span>
        {'provider' in result ? (
          <span className='inline-flex items-center gap-1'>
            <ProviderGlyph provider={result.provider} className='size-3' />
            <span className='font-mono'>{result.model}</span>
          </span>
        ) : (
          <span>No model selected</span>
        )}
        <span>Created by {result.createdBy === 'agent' ? 'an agent' : 'you'}</span>
      </div>
      <p className='mt-3 break-all font-mono text-xs text-muted-foreground'>{result.id}</p>
      <p className='mt-4 text-xs text-muted-foreground'>
        In the app, the link would open this thread.
      </p>
    </section>
  )
}

function OtherTools({ onSelect }: { onSelect: (result: ThreadResult) => void }) {
  return (
    <section className='min-w-0' aria-label='Other Jetty tools'>
      <h2 className='mb-4 text-sm font-medium'>The same treatment elsewhere</h2>
      <div className='work-scroll'>
        <Disclosure title='Created thread'>
          <div className='pl-2'>
            <ThreadRow result={threadResults[1]} onSelect={onSelect} />
          </div>
        </Disclosure>
        <p className='py-1 text-xs leading-relaxed text-muted-foreground'>
          Read, message, stop and archive would use the same thread link.
        </p>
        <Disclosure title='Added project'>
          <div className='activity-header gap-1.5 pl-2 text-foreground'>
            <ProjectGlyph className='size-3.25' /> loci
          </div>
        </Disclosure>
        <Disclosure title='Listed 2 tasks'>
          <div className='pl-2'>
            <div className='activity-header gap-1.5 text-foreground'>
              <CheckListIcon className='size-3.25 text-muted-foreground' /> Review the streaming UI
            </div>
            <div className='activity-header gap-1.5 text-foreground'>
              <StatusGlyph status='done' className='size-3.25' /> Test queued messages
            </div>
          </div>
        </Disclosure>
        <Disclosure title='Linked pull request'>
          <div className='activity-header gap-1.5 pl-2 text-status-success'>
            <GitPullRequestIcon className='size-3.25' />
            <span className='font-mono'>#42</span> Tighten the streaming UI
          </div>
        </Disclosure>
      </div>
      <p className='mt-4 text-xs text-muted-foreground'>
        Project, task and PR rows are illustrative.
      </p>
    </section>
  )
}

function App() {
  const [selected, setSelected] = useState<ThreadResult>(threadResults[1])
  return (
    <TooltipProvider>
      <main className='mx-auto min-h-dvh max-w-6xl px-6 py-12 md:px-10'>
        <header className='mb-12 flex flex-col gap-2'>
          <h1 className='text-sm font-medium'>Jetty tool results</h1>
          <p className='max-w-2xl text-13 leading-relaxed text-muted-foreground'>
            Six models and six threads sampled from “Testing Jetty UI with placeholder requests”.
            Expand model names for effort details; click thread titles to preview them below.
          </p>
        </header>
        <div className='grid gap-12 md:grid-cols-2 md:gap-16'>
          <ListingExample kind='models' onSelect={setSelected} />
          <ListingExample kind='threads' onSelect={setSelected} />
          <OtherTools onSelect={setSelected} />
          <ThreadPreview result={selected} />
        </div>
        <section className='mt-12 max-w-lg' aria-label='Fallbacks'>
          <h2 className='mb-4 text-sm font-medium'>When we can’t resolve an entity</h2>
          <div className='work-scroll'>
            <div className='activity-header text-muted-foreground'>
              <span className='font-mono'>thread-unknown</span>
              <span className='text-xs'>Thread unavailable</span>
            </div>
            <Disclosure title='Unrecognised tool output'>
              <RawResult
                name='list_threads'
                output={{ message: 'Result format not recognised', data: [] }}
              />
            </Disclosure>
          </div>
          <p className='mt-3 text-xs leading-relaxed text-muted-foreground'>
            Preserve a plain identifier and the original output when a rich row isn’t possible.
          </p>
        </section>
      </main>
    </TooltipProvider>
  )
}

if (import.meta.env.DEV) {
  applyTheme()
  document.documentElement.dataset.accent = loadAccent()
  createRoot(document.getElementById('root')!).render(<App />)
}
