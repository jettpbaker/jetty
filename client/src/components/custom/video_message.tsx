import type { Attachment } from '@jetty/shared/items'

import { fittedStyle, INLINE_IMAGE_MAX_HEIGHT, mediaUrl } from '@/components/custom/media_layout'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import {
  CornersIn,
  CornersOut,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerSlash,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState, type RefObject } from 'react'

// Survive the virtualizer unmounting a row: a video scrolled back into view resumes where it paused.
const positions = new Map<string, number>()
let playing: HTMLVideoElement | null = null

const idleDelay = 2000

function formatTime(seconds: number) {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function VideoMessage({ video, caption }: { video: Attachment; caption?: string }) {
  return (
    <Message align='start'>
      <MessageContent>
        <figure className='flex flex-col gap-2'>
          <VideoPlayer video={video} />
          {caption ? (
            <figcaption className='text-sm text-muted-foreground'>{caption}</figcaption>
          ) : null}
        </figure>
      </MessageContent>
    </Message>
  )
}

export function VideoPlayer({ video, onError }: { video: Attachment; onError?: () => void }) {
  const frame = useRef<HTMLDivElement>(null)
  const media = useRef<HTMLVideoElement>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [started, setStarted] = useState(() => positions.has(video.id))
  const [paused, setPaused] = useState(true)
  const [muted, setMuted] = useState(false)
  const [awake, setAwake] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [duration, setDuration] = useState<number>()
  const fitted = fittedStyle(video, INLINE_IMAGE_MAX_HEIGHT)

  useEffect(() => {
    const element = media.current
    const onFullscreen = () => setFullscreen(document.fullscreenElement === frame.current)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      clearTimeout(idleTimer.current)
      if (!element) return
      // Not currentTime > 0: the #t= poster fragment leaves an unplayed video at 0.001.
      if (element.played.length > 0 || positions.has(video.id))
        positions.set(video.id, element.currentTime)
      if (playing === element) playing = null
    }
  }, [video.id])

  function toggle() {
    const element = media.current
    if (!element) return
    if (element.paused || element.ended) void element.play()
    else element.pause()
  }

  function wake() {
    setAwake(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setAwake(false), idleDelay)
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void frame.current?.requestFullscreen()
  }

  const controls = paused || awake

  return (
    <div
      ref={frame}
      data-controls={controls ? 'shown' : 'hidden'}
      className={cn(
        'group/video relative overflow-hidden rounded-lg bg-black data-[controls=hidden]:cursor-none [&:fullscreen]:rounded-none',
        fitted ? 'max-w-full' : 'aspect-video max-h-120 w-full'
      )}
      style={fitted}
      onPointerMove={wake}
      onPointerLeave={() => setAwake(false)}
    >
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- agent screen recordings have no caption track */}
      <video
        ref={media}
        // The fragment paints the resume frame (or the first one) instead of a black box.
        src={`${mediaUrl(video)}#t=${positions.get(video.id) ?? 0.001}`}
        preload='metadata'
        playsInline
        tabIndex={-1}
        className='size-full object-contain'
        onDurationChange={({ currentTarget }) => {
          if (Number.isFinite(currentTarget.duration)) setDuration(currentTarget.duration)
        }}
        onPlay={({ currentTarget }) => {
          if (playing && playing !== currentTarget) playing.pause()
          playing = currentTarget
          setStarted(true)
          setPaused(false)
          wake()
        }}
        onPause={() => setPaused(true)}
        onError={onError}
        onVolumeChange={({ currentTarget }) => setMuted(currentTarget.muted)}
      />
      <button
        type='button'
        aria-label={`${paused ? 'Play' : 'Pause'} ${video.name}`}
        tabIndex={started ? -1 : 0}
        className='absolute inset-0 grid place-items-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset'
        onClick={toggle}
      >
        {!started && (
          <span className='grid size-12 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform group-hover/video:scale-105 motion-reduce:transition-none'>
            <Play weight='fill' className='size-5' />
          </span>
        )}
      </button>
      {!started && duration !== undefined && (
        <span className='pointer-events-none absolute right-2 bottom-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-xs text-white tabular-nums'>
          {formatTime(duration)}
        </span>
      )}
      {started && (
        <div className='dark absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-black/85 via-black/55 to-transparent p-1.5 pt-14 text-foreground opacity-0 transition-opacity group-has-focus-visible/video:opacity-100 group-data-[controls=shown]/video:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100'>
          <Button
            variant='ghost'
            size='icon'
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={toggle}
          >
            {paused ? <Play weight='fill' /> : <Pause weight='fill' />}
          </Button>
          <Scrubber media={media} duration={duration} />
          <Button
            variant='ghost'
            size='icon'
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => {
              if (media.current) media.current.muted = !media.current.muted
            }}
          >
            {muted ? <SpeakerSlash /> : <SpeakerHigh />}
          </Button>
          <Button
            variant='ghost'
            size='icon'
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <CornersIn /> : <CornersOut />}
          </Button>
        </div>
      )}
    </div>
  )
}

// Owns the per-frame time so playback re-renders only the scrubber, not the player.
function Scrubber({
  media,
  duration,
}: {
  media: RefObject<HTMLVideoElement | null>
  duration?: number
}) {
  const [time, setTime] = useState(() => media.current?.currentTime ?? 0)

  useEffect(() => {
    const element = media.current
    if (!element) return
    let frame = 0
    const sync = () => setTime(element.currentTime)
    const tick = () => {
      sync()
      if (!element.paused && !element.ended) frame = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    }
    element.addEventListener('play', start)
    element.addEventListener('seeked', sync)
    element.addEventListener('timeupdate', sync)
    if (!element.paused) start()
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('play', start)
      element.removeEventListener('seeked', sync)
      element.removeEventListener('timeupdate', sync)
    }
  }, [media])

  return (
    <>
      <span className='px-1 text-xs whitespace-nowrap tabular-nums'>
        {formatTime(time)}
        {duration === undefined ? null : (
          <span className='text-muted-foreground'> / {formatTime(duration)}</span>
        )}
      </span>
      <Slider
        aria-label='Seek'
        className='mx-2 flex-1 [&_[data-slot=slider-range]]:bg-foreground [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-track]]:bg-foreground/25'
        min={0}
        max={duration ?? 1}
        step={(duration ?? 1) / 100}
        value={Math.min(time, duration ?? 0)}
        disabled={duration === undefined}
        onValueChange={(value) => {
          const next = Array.isArray(value) ? value[0]! : value
          if (media.current) media.current.currentTime = next
          setTime(next)
        }}
      />
    </>
  )
}
