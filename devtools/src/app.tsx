import type { CSSProperties } from 'react'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Filter } from './log'
import type { Selection, View } from './timeline'
import type { BotRow } from './wire'

import { formatDuration } from './format'
import { buildTimeline } from './lanes'
import { filterOf, Log } from './log'
import { useBotStream } from './stream'
import { DEFAULT_SCALE, TimelineView } from './timeline'

function botFromUrl() {
  return new URLSearchParams(window.location.search).get('bot')
}

export function App() {
  const [bots, setBots] = useState<BotRow[]>([])
  const [botId, setBotId] = useState(botFromUrl)
  const { sources, error, connected } = useBotStream(botId)
  const timeline = useMemo(() => (sources ? buildTimeline(sources) : null), [sources])
  const [view, setView] = useState<View>({ scale: DEFAULT_SCALE, left: 0 })
  const [following, setFollowing] = useState(true)
  const [selection, setSelection] = useState<Selection>(null)
  const [expanded, setExpanded] = useState(() => new Set<string>())
  const [hidden, setHidden] = useState(() => new Set<Filter>(['quiet']))
  const [now, setNow] = useState(Date.now)
  const running = !!timeline?.runningTurn

  const chooseBot = useCallback((id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('bot', id)
    window.history.replaceState(null, '', url)
    setBotId(id)
    setSelection(null)
    setExpanded(new Set())
    setFollowing(true)
  }, [])

  useEffect(() => {
    void fetch('/api/bots')
      .then((response) => response.json() as Promise<BotRow[]>)
      .then((list) => {
        setBots(list)
        if (!botFromUrl() && list[0]) chooseBot(list[0].id)
      })
  }, [chooseBot])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), following && running ? 100 : 500)
    return () => clearInterval(timer)
  }, [following, running])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return
      if (event.key === 'Escape') setSelection(null)
      if (event.key === 'l' && !event.metaKey && !event.ctrlKey) setFollowing(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onView = useCallback((next: View, follow: boolean) => {
    setView(next)
    setFollowing(follow)
  }, [])

  // A bar opens its row, showing its lane in the log if it was filtered out; a row toggles.
  const select = useCallback(
    (id: string | null, from: 'timeline' | 'log') => {
      if (!id) return setSelection(null)
      setFollowing(false)
      setSelection({ id, from })
      setExpanded((previous) => {
        const next = new Set(previous)
        if (from === 'log' && next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      const span = timeline?.byId.get(id)
      if (span && from === 'timeline')
        setHidden((previous) => {
          const next = new Set(previous)
          next.delete(filterOf(span))
          if (span.quiet) next.delete('quiet')
          return next.size === previous.size ? previous : next
        })
    },
    [timeline]
  )

  const bot = sources?.bot ?? bots.find((candidate) => candidate.id === botId)
  const lastActivity = timeline?.activity.at(-1)

  return (
    <div
      className='app'
      style={{ '--bot': `var(--bot-${bot?.color ?? 'lilac'})` } as CSSProperties}
    >
      <header className='top'>
        <span className='brand'>
          Jetty <span className='muted'>bot timeline</span>
        </span>
        <label className='picker'>
          <span className='dot' />
          <select
            value={botId ?? ''}
            onChange={(event) => chooseBot(event.target.value)}
            aria-label='Bot'
          >
            {bots.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        {timeline && bot && (
          <span className='pipeline'>
            Jett <Arrow /> <span className='bot-name'>{bot.name}</span>{' '}
            <span className='mono'>{timeline.model}</span>
            {timeline.workerModels.length > 0 && (
              <>
                {' '}
                <Arrow /> workers <span className='mono'>{timeline.workerModels.join(', ')}</span>
              </>
            )}
          </span>
        )}
        <span className='spacer' />
        {error && <span className='error-text'>{error}</span>}
        {!connected && botId && !error && <span className='muted'>Connecting…</span>}
        {timeline && (
          <span className='status' data-running={running || undefined}>
            <span className='status-dot' />
            {running && timeline.runningTurn
              ? `${timeline.runningTurn.private ? 'Private turn' : 'Turn'} running · ${formatDuration(now - timeline.runningTurn.start)}`
              : lastActivity
                ? `Idle · ${formatDuration(now - lastActivity)}`
                : 'Idle'}
          </span>
        )}
        <button
          type='button'
          className='live'
          data-on={following || undefined}
          onPointerDown={(event) => event.button === 0 && setFollowing(true)}
          onClick={() => setFollowing(true)}
          title='Follow now (L)'
        >
          <span className='live-dot' />
          {following ? 'Live' : 'Jump to live'}
        </button>
      </header>
      {timeline && sources ? (
        <>
          <TimelineView
            timeline={timeline}
            now={now}
            view={view}
            following={following}
            selection={selection}
            onView={onView}
            onSelect={(id) => select(id, 'timeline')}
          />
          <Log
            timeline={timeline}
            threads={sources.threads}
            selection={selection}
            expanded={expanded}
            hidden={hidden}
            following={following}
            onToggleFilter={(filter) =>
              setHidden((previous) => {
                const next = new Set(previous)
                if (next.has(filter)) next.delete(filter)
                else next.add(filter)
                return next
              })
            }
            onSelect={(id) => select(id, 'log')}
            onPause={() => setFollowing(false)}
          />
        </>
      ) : (
        <div className='empty'>{bots.length || !botId ? 'Loading…' : 'No bots yet.'}</div>
      )}
    </div>
  )
}

function Arrow() {
  return <span className='arrow'>→</span>
}
