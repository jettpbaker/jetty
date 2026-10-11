import { Markdown } from '@/components/custom/markdown'
import { UserMessage } from '@/components/custom/user_message'
import { WorkBlock } from '@/components/custom/work_block'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { loadAccent } from '@/lib/accent'
import { getMotionTokens } from '@/lib/motion'
import { pressProps } from '@/lib/press'
import { applyTheme } from '@/lib/theme'
import { chromeSnapshotAtom } from '@/state/chrome'
import { StateProvider } from '@/state/provider'
import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import '../index.css'
import '../accent.css'

const options = [
  {
    title: 'Current glide',
    detail: '250ms · fast start',
    duration: 250,
    gentle: false,
    spring: false,
    continuous: false,
  },
  {
    title: 'No initial nudge',
    detail: '250ms · starts at the current scroll position',
    duration: 250,
    gentle: false,
    spring: false,
    continuous: true,
  },
  {
    title: 'Gentler start',
    detail: '350ms · ease in and out',
    duration: 350,
    gentle: true,
    spring: false,
    continuous: false,
  },
  {
    title: 'Spring settle',
    detail: '300ms spring · no bounce',
    duration: 300,
    gentle: false,
    spring: true,
    continuous: false,
  },
]

const response =
  "I'll check the layout and spacing first, then tighten up the transitions. The existing components can stay in place while I work through those changes."
const responseWords = response.split(' ')

function Example({ option, run }: { option: (typeof options)[number]; run: number }) {
  const [localRun, setLocalRun] = useState(0)
  const [sent, setSent] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const animationRef = useRef<ReturnType<typeof animate> | null>(null)

  function stop() {
    animationRef.current?.stop()
  }

  const interrupt = useEffectEvent(stop)
  useEffect(() => {
    const scroller = scrollerRef.current!
    const events = ['wheel', 'touchstart', 'keydown'] as const
    for (const event of events) scroller.addEventListener(event, interrupt)
    return () => {
      for (const event of events) scroller.removeEventListener(event, interrupt)
    }
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current!
    scroller.scrollTop = scroller.scrollHeight
    setSent(false)
    setWordCount(0)
    const timer = setTimeout(() => setSent(true), 800)
    return () => {
      clearTimeout(timer)
      animationRef.current?.stop()
    }
  }, [run, localRun])

  useLayoutEffect(() => {
    if (!sent) return
    const scroller = scrollerRef.current!
    const message = messageRef.current!
    message.style.minHeight = `${scroller.clientHeight - 48}px`
    const top =
      message.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      24
    const userHeight = (message.firstElementChild as HTMLElement).offsetHeight
    const start = option.continuous
      ? scroller.scrollTop
      : Math.max(0, top - scroller.clientHeight + userHeight + 48)
    scroller.scrollTop = start
    if (reducedMotion) {
      scroller.scrollTop = top
      return
    }
    animationRef.current = animate(start, top, {
      ...(option.spring
        ? { type: 'spring' as const, duration: option.duration / 1000, bounce: 0 }
        : {
            duration: option.duration / 1000,
            ease: option.gentle
              ? ([0.4, 0, 0.2, 1] as [number, number, number, number])
              : getMotionTokens().disclosure.ease,
          }),
      onUpdate: (value) => {
        scroller.scrollTop = value
      },
    })
    return () => {
      animationRef.current?.stop()
    }
  }, [sent, option, reducedMotion])

  useEffect(() => {
    if (!sent) return
    const timers = responseWords.map((_, index) =>
      setTimeout(() => setWordCount(index + 1), 850 + index * 55)
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [sent])

  return (
    <section aria-label={option.title}>
      <div className='mb-4 flex items-center justify-between gap-4'>
        <div>
          <h2 className='text-sm font-medium'>{option.title}</h2>
          <p className='mt-1 text-xs text-muted-foreground'>{option.detail}</p>
        </div>
        <Button
          size='sm'
          aria-label={`Replay ${option.title}`}
          {...pressProps(() => {
            stop()
            setLocalRun(localRun + 1)
          })}
        >
          Replay
        </Button>
      </div>
      <section
        ref={scrollerRef}
        className='relative overflow-y-auto overscroll-contain no-scrollbar'
        style={{ overflowAnchor: 'none', height: 'min(70dvh, 640px)' }}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- each independent conversation needs keyboard scrolling
        tabIndex={0}
        aria-label={`${option.title} conversation`}
      >
        <div className='flex min-h-full flex-col gap-6 px-2 py-6'>
          <UserMessage
            id={`${option.title}:earlier`}
            threadId='send-motion'
            text='How are the file and command details looking?'
            attachments={[]}
            createdAt={1791699900000}
          />
          <Markdown>
            {
              'File operations and Bash commands now use a cumulative counter. Each batch can be expanded to inspect its individual actions.\n\nThe descriptions stay inside the dropdown, with the command and output available one level below. Failures retain their operation name and error details.\n\nThe work history shows its five latest actions by default. Opening Working reveals the complete history, so earlier actions remain accessible without filling the chat.'
            }
          </Markdown>
          <UserMessage
            id={`${option.title}:old`}
            threadId='send-motion'
            text='Can you take a look at the streaming UI?'
            attachments={[]}
            createdAt={1791700000000}
          />
          <Markdown>
            {
              'The work history now uses consistent spacing, with five recent items visible while the assistant is working.\n\nYou can expand Working to see the full history, or open individual tool calls for their details.\n\nThe file and command counters use the same behavior, and text stays in the work history until the final response arrives.'
            }
          </Markdown>
          <Markdown>
            {
              'The next step is to try it with a fresh conversation and see how the transitions feel during actual use.'
            }
          </Markdown>
          {sent && (
            <div ref={messageRef} data-sent-message className='flex flex-col gap-6'>
              <UserMessage
                id={`${option.title}:sent`}
                threadId='send-motion'
                text='Nice, can you tighten up the spacing and animations?'
                attachments={[]}
                createdAt={1791700060000}
              />
              <WorkBlock
                threadId='send-motion'
                status='running'
                activities={
                  wordCount
                    ? [
                        {
                          type: 'text',
                          id: 'reply',
                          text: responseWords.slice(0, wordCount).join(' '),
                          streaming: wordCount < responseWords.length,
                        },
                      ]
                    : []
                }
              />
            </div>
          )}
        </div>
      </section>
    </section>
  )
}

function App() {
  const [run, setRun] = useState(0)
  return (
    <StateProvider initialValues={[[chromeSnapshotAtom, { projects: [], threads: [], bots: [] }]]}>
      <TooltipProvider>
        <main className='mx-auto max-w-6xl px-6 py-10 md:px-10'>
          <header className='mb-10 flex items-center justify-between gap-6'>
            <div>
              <h1 className='text-sm font-medium'>Send anchoring</h1>
              <p className='mt-2 text-sm text-muted-foreground'>
                Compare longer travel at chat height. Each replay starts with the previous
                conversation.
              </p>
            </div>
            <Button size='sm' {...pressProps(() => setRun(run + 1))}>
              Replay all
            </Button>
          </header>
          <div className='grid gap-x-12 gap-y-10 md:grid-cols-2'>
            {options.map((option) => (
              <Example key={`${run}:${option.title}`} option={option} run={run} />
            ))}
          </div>
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
