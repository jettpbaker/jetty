import type { ProviderModel } from '@jetty/shared/wire'

import { ActivityChevron } from '@/components/custom/activity_disclosure'
import { botColorStyle, botTextClass } from '@/components/custom/bot_avatar'
import { Refresh01Icon } from '@/components/custom/huge_icons'
import { JettyBot } from '@/components/custom/jetty_bot'
import { GitPullRequestIcon } from '@/components/custom/lucide_icons'
import { ModelLabel } from '@/components/custom/model_label'
import { ProjectGlyph } from '@/components/custom/project_glyph'
import { ProviderGlyph } from '@/components/custom/provider_glyph'
import { RollingNumber } from '@/components/custom/rolling_number'
import { StatusGlyph, threadStatus, type Status } from '@/components/custom/thread_status'
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

function Disclosure({
  title,
  label,
  children,
}: {
  title: ReactNode
  label?: string
  children: ReactNode
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='activity-header'
        aria-label={label}
      >
        <span>{title}</span>
        <ActivityChevron />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

function CappedResults({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      className='max-h-35 overflow-y-auto overscroll-contain'
      aria-label={label}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need focus to scroll the remaining rows
      tabIndex={0}
    >
      {children}
    </section>
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
  status,
}: {
  result: ThreadResult
  onSelect: (result: ThreadResult) => void
  status?: Status
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
        <StatusGlyph status={status ?? threadStatus(result.status)} className='size-3.25' />
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
  const [open, setOpen] = useState(false)
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
    setOpen(false)
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
          setOpen(next === 'empty' || next === 'failed')
        }}
      >
        {resultStates.map((value) => (
          <ToggleGroupItem key={value} value={value} className='capitalize'>
            {value === 'complete' ? 'Results' : value}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className='work-scroll mt-8' data-listing={kind}>
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
                <CappedResults label={`Returned ${kind}`}>
                  {kind === 'models'
                    ? modelResults.map((model) => <ModelRow key={model.id} result={model} />)
                    : threadResults.map((thread) => (
                        <ThreadRow key={thread.id} result={thread} onSelect={onSelect} />
                      ))}
                </CappedResults>
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

const threadActions = [
  { active: 'Creating', done: 'Created' },
  { active: 'Archiving', done: 'Archived' },
  { active: 'Stopping', done: 'Stopped' },
  { active: 'Reading', done: 'Read' },
  { active: 'Searching', done: 'Found' },
] as const

const sampleTasks = [
  { title: 'Review the streaming UI', status: 'working', note: 'Checking the latest replay.' },
  { title: 'Test queued messages', status: 'done', note: 'Checked single and multiple messages.' },
  { title: 'Review approval states', status: 'queued', note: 'Ready to check next.' },
] as const

const sampleBots = [
  { name: 'UI', color: 'lilac', shape: 'circle', job: 'Reviews the Jetty interface.' },
  { name: 'Build', color: 'mint', shape: 'squircle', job: 'Checks builds and dependencies.' },
  { name: 'Inbox', color: 'coral', shape: 'tri', job: 'Keeps track of incoming work.' },
] as const

function CountedResults({
  verb,
  count,
  noun,
  active = false,
  children,
}: {
  verb: string
  count: number
  noun: string
  active?: boolean
  children: ReactNode
}) {
  const label = `${verb} ${count} ${noun}${count === 1 ? '' : 's'}`
  return (
    <Disclosure
      label={label}
      title={
        <span className='inline-flex items-baseline gap-1'>
          <span className={cn(active && 'shimmer')}>{verb}</span>
          <RollingNumber value={count} className='font-mono' />
          <span>
            {noun}
            {count === 1 ? '' : 's'}
          </span>
        </span>
      }
    >
      <div className='pl-2'>
        <CappedResults label={label}>{children}</CappedResults>
      </div>
    </Disclosure>
  )
}

function EntityDetails({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Disclosure title={title}>
      <div className='py-1 pl-2 text-xs leading-relaxed text-muted-foreground'>{children}</div>
    </Disclosure>
  )
}

function OtherTools({ onSelect }: { onSelect: (result: ThreadResult) => void }) {
  const [count, setCount] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (!playing) return
    const timers = [
      setTimeout(() => setCount(2), 650),
      setTimeout(() => setCount(3), 1300),
      setTimeout(() => setPlaying(false), 2100),
    ]
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [playing, run])
  function replay() {
    setCount(1)
    setPlaying(true)
    setRun((value) => value + 1)
  }
  return (
    <section className='min-w-0 md:col-span-2' aria-label='Other Jetty tools'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-4'>
        <h2 className='text-sm font-medium'>Other Jetty tools</h2>
        <div className='flex items-center gap-4'>
          <ToggleGroup
            size='sm'
            value={[String(count)]}
            aria-label='Batch size'
            onValueChange={(values) => {
              const next = Number(values[0])
              if (next !== 1 && next !== 3) return
              setPlaying(false)
              setCount(next)
            }}
          >
            <ToggleGroupItem value='1'>Single</ToggleGroupItem>
            <ToggleGroupItem value='3'>Batch of 3</ToggleGroupItem>
          </ToggleGroup>
          <Button variant='ghost' size='sm' {...pressProps(replay)}>
            <Refresh01Icon data-icon='inline-start' /> Replay
          </Button>
        </div>
      </div>
      <p className='mb-6 text-13 text-muted-foreground'>
        One item uses the same collapsed group as three. Replay grows the batch from one to three.
      </p>
      <div key={run} className='grid gap-8 md:grid-cols-2 md:gap-16'>
        <div className='work-scroll min-w-0' aria-label='Thread actions'>
          {threadActions.map((action) => (
            <CountedResults
              key={action.done}
              verb={playing ? action.active : action.done}
              noun='thread'
              count={count}
              active={playing}
            >
              {threadResults.slice(1, count + 1).map((thread) => (
                <ThreadRow
                  key={thread.id}
                  result={thread}
                  onSelect={onSelect}
                  status={action.done === 'Stopped' ? 'stopped' : undefined}
                />
              ))}
            </CountedResults>
          ))}
        </div>
        <div className='work-scroll min-w-0' aria-label='Entity actions'>
          <CountedResults verb='Listed' count={count} noun='bot'>
            {sampleBots.slice(0, count).map((bot) => (
              <EntityDetails
                key={bot.name}
                title={
                  <span
                    style={botColorStyle(bot.color)}
                    className={cn('inline-flex items-center gap-1.5', botTextClass)}
                  >
                    <JettyBot size={14} color={bot.color} shape={bot.shape} />
                    {bot.name}
                  </span>
                }
              >
                {bot.job}
              </EntityDetails>
            ))}
          </CountedResults>
          {['Added', 'Updated', 'Listed'].map((verb) => (
            <CountedResults key={verb} verb={verb} count={count} noun='task'>
              {sampleTasks.slice(0, count).map((task) => (
                <EntityDetails
                  key={task.title}
                  title={
                    <span className='inline-flex items-center gap-1.5 text-foreground'>
                      <StatusGlyph status={task.status} className='size-3.25' />
                      {task.title}
                    </span>
                  }
                >
                  {task.note}
                </EntityDetails>
              ))}
            </CountedResults>
          ))}
          <CountedResults verb='Added' count={count} noun='project'>
            {['loci', 'jetty', 'home'].slice(0, count).map((project) => (
              <EntityDetails
                key={project}
                title={
                  <span className='inline-flex items-center gap-1.5 text-foreground'>
                    <ProjectGlyph className='size-3.25' />
                    {project}
                  </span>
                }
              >
                Project preview: {project}
              </EntityDetails>
            ))}
          </CountedResults>
          <CountedResults verb='Linked' count={count} noun='pull request'>
            {['Tighten the streaming UI', 'Refine approval states', 'Polish queued messages']
              .slice(0, count)
              .map((title, index) => (
                <EntityDetails
                  key={title}
                  title={
                    <span className='inline-flex items-center gap-1.5 text-pr-open'>
                      <GitPullRequestIcon className='size-3.25' />
                      <span className='font-mono'>#{42 + index}</span>
                      {title}
                    </span>
                  }
                >
                  Open pull request · {title}
                </EntityDetails>
              ))}
          </CountedResults>
        </div>
      </div>
      <p className='mt-6 text-xs text-muted-foreground'>
        These actions and bot, task and PR details are illustrative. Bot listing, task tools and
        thread search are available to bots.
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
