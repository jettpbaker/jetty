import { Markdown } from '@/components/custom/markdown'
import { ThinkingBlock } from '@/components/custom/thinking_block'
import { ToolGroup } from '@/components/custom/tool_group'
import { WorkBlock } from '@/components/custom/work_block'
import { groupWorkActivities, type WorkActivity } from '@/components/custom/work_model'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { loadAccent } from '@/lib/accent'
import { pressProps } from '@/lib/press'
import { applyTheme } from '@/lib/theme'
import { chromeSnapshotAtom } from '@/state/chrome'
import { StateProvider } from '@/state/provider'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import '../index.css'
import '../accent.css'

const reply = "I'll start by reading the six files you allowed, plus a Glob limited to `src`."
const words = reply.match(/\S+\s*/g)!
const replyAt = 800
const wordMs = 60
const toolAt = replyAt + words.length * wordMs + 500

function activitiesAt(step: number): WorkActivity[] {
  const activities: WorkActivity[] = [
    {
      type: 'thinking',
      id: 'thinking',
      status: step === 0 ? 'running' : 'complete',
      summary: '',
      tokens: 50,
    },
  ]
  if (step > 0)
    activities.push({
      type: 'text',
      id: 'reply',
      text: words.slice(0, step).join(''),
      streaming: step < words.length,
    })
  if (step > words.length)
    activities.push({
      type: 'tool',
      id: 'read',
      kind: 'read',
      name: 'Read',
      target: 'package.json',
      status: step === words.length + 1 ? 'running' : 'complete',
      input: '{ "file_path": "package.json" }',
      output: '{ "name": "cloudlets" }',
    })
  return activities
}

// This isolated experiment has at most three entries, so it needs no preview scrolling.
function RaisedWork({ activities }: { activities: WorkActivity[] }) {
  const reducedMotion = useReducedMotion()
  const entries = groupWorkActivities(activities, false)
  return (
    <div className='min-w-0'>
      <div className='activity-header text-muted-foreground' data-flush>
        <span>
          <span className='shimmer'>Working</span>
        </span>
      </div>
      <div className='pb-1'>
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              data-entrance-row
              initial={{ opacity: 0, transform: reducedMotion ? 'none' : 'translateY(8px)' }}
              animate={{ opacity: 1, transform: reducedMotion ? 'none' : 'translateY(0px)' }}
              transition={{ duration: reducedMotion ? 0.15 : 0.25, ease: [0.25, 1, 0.5, 1] }}
            >
              {entry.type === 'thinking' ? (
                <ThinkingBlock activity={entry} />
              ) : entry.type === 'text' ? (
                <Markdown className='work-text' streaming={entry.streaming} reply={entry.id}>
                  {entry.text}
                </Markdown>
              ) : entry.type === 'tools' ? (
                <ToolGroup batch={entry} />
              ) : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function Example({ activities, identity }: { activities: WorkActivity[]; identity: string }) {
  const current = activities.map((activity) => ({
    ...activity,
    id: `${identity}:current:${activity.id}`,
  }))
  const raised = activities.map((activity) => ({
    ...activity,
    id: `${identity}:raised:${activity.id}`,
  }))
  return (
    <div className='grid gap-12 md:grid-cols-2 md:gap-16'>
      <section aria-labelledby='current-label' data-example='current'>
        <h2 id='current-label' className='mb-8 text-sm font-medium'>
          Current
        </h2>
        <WorkBlock threadId='motion-comparison' activities={current} status='running' />
      </section>
      <section aria-labelledby='raised-label' data-example='raised'>
        <h2 id='raised-label' className='mb-8 text-sm font-medium'>
          Raise up
        </h2>
        <RaisedWork activities={raised} />
      </section>
    </div>
  )
}

function Sequence() {
  const [identity] = useState(() => crypto.randomUUID())
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let index = 0; index < words.length; index++)
      timers.push(setTimeout(() => setStep(index + 1), replyAt + index * wordMs))
    timers.push(setTimeout(() => setStep(words.length + 1), toolAt))
    timers.push(setTimeout(() => setStep(words.length + 2), toolAt + 700))
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])
  return <Example activities={activitiesAt(step)} identity={identity} />
}

function App() {
  const [run, setRun] = useState(0)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    async function loadFonts() {
      await Promise.all([
        document.fonts.load('14px "Geist Variable"'),
        document.fonts.load('14px "Paper Mono"'),
      ])
      if (active) setReady(true)
    }
    void loadFonts()
    return () => {
      active = false
    }
  }, [])
  return (
    <StateProvider initialValues={[[chromeSnapshotAtom, { projects: [], threads: [], bots: [] }]]}>
      <TooltipProvider>
        <main className='mx-auto min-h-dvh max-w-6xl px-6 py-12 md:px-10'>
          <header className='mb-16 flex items-center justify-between gap-4'>
            <h1 className='text-sm font-medium'>Work history entrances</h1>
            <Button size='sm' disabled={!ready} {...pressProps(() => setRun(run + 1))}>
              Replay
            </Button>
          </header>
          {ready && <Sequence key={run} />}
        </main>
      </TooltipProvider>
    </StateProvider>
  )
}

if (import.meta.env.DEV) {
  applyTheme()
  document.documentElement.dataset.accent = loadAccent()
  createRoot(document.getElementById('root')!).render(<App />)
}
