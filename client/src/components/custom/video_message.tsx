import type { Attachment } from '@jetty/shared/items'

import {
  ArrowShrink02Icon,
  ArrowExpand01Icon,
  PauseIcon,
  PlayIcon,
  VolumeHighIcon,
  VolumeMute02Icon,
} from '@/components/custom/huge_icons'
import { MediaActions } from '@/components/custom/media_actions'
import {
  fittedStyle,
  INLINE_IMAGE_MAX_HEIGHT,
  mediaUrl,
  useVideoSize,
} from '@/components/custom/media_layout'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import { cn } from '@/lib/utils'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { useEffect, useRef, useState, type RefObject } from 'react'

// Survive the virtualizer unmounting a row: a video scrolled back into view resumes where it paused.
const positions = new Map<string, number>()
let playing: HTMLVideoElement | null = null

const idleDelay = 2000

export function VideoMessage({
  video,
  caption,
  align = 'start',
}: {
  video: Attachment
  caption?: string
  align?: 'start' | 'center'
}) {
  return (
    <Message align='start'>
      <MessageContent>
        <figure className='flex flex-col gap-2'>
          <VideoPlayer
            video={video}
            className={align === 'center' ? 'mx-auto' : undefined}
            actions
          />
          {caption ? (
            <figcaption className='text-sm text-muted-foreground'>{caption}</figcaption>
          ) : null}
        </figure>
      </MessageContent>
    </Message>
  )
}

export function VideoPlayer({
  video,
  src,
  className,
  actions = false,
  onError,
}: {
  video: Attachment
  src?: string
  className?: string
  actions?: boolean
  onError?: () => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const media = useRef<HTMLVideoElement>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [started, setStarted] = useState(() => positions.has(video.id))
  const [paused, setPaused] = useState(true)
  const [muted, setMuted] = useState(false)
  const [awake, setAwake] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [duration, setDuration] = useState<number>()
  const probed = useVideoSize(src ?? mediaUrl(video), !video.width)
  const fitted = fittedStyle(video.width ? video : { ...video, ...probed }, INLINE_IMAGE_MAX_HEIGHT)

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
        'group/video group/media relative overflow-hidden rounded-md bg-black data-[controls=hidden]:cursor-none [&:fullscreen]:rounded-none',
        fitted ? 'max-w-full' : 'aspect-video max-h-120 w-full',
        className
      )}
      style={fitted}
      onPointerMove={wake}
      onPointerLeave={() => setAwake(false)}
    >
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- agent screen recordings have no caption track */}
      <video
        ref={media}
        // The fragment paints the resume frame (or the first one) instead of a black box.
        src={`${src ?? mediaUrl(video)}#t=${positions.get(video.id) ?? 0.001}`}
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
          <span className='grid size-12 place-items-center rounded-full bg-black/35 text-white backdrop-blur-md backdrop-saturate-150 transition-transform group-hover/video:scale-105 motion-reduce:transition-none'>
            <PlayIcon filled className='size-5' />
          </span>
        )}
      </button>
      {
        // The same frosted glass as MediaActions, floating inside the frame; before the first play it
        // shows with the timeline at the start.
        <div className='dark absolute inset-x-2 bottom-2 flex items-center gap-0.5 rounded-sm bg-black/35 p-0.5 text-foreground opacity-0 backdrop-blur-md backdrop-saturate-150 transition-opacity group-has-focus-visible/video:opacity-100 group-data-[controls=shown]/video:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100'>
          <Button
            variant='ghost'
            size='icon-sm'
            className='rounded-menu-item text-foreground hover:bg-white/10 not-disabled:hover:bg-white/10'
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={toggle}
          >
            {paused ? <PlayIcon filled /> : <PauseIcon filled />}
          </Button>
          <Scrubber media={media} duration={duration} />
          <Volume media={media} muted={muted} />
          <Button
            variant='ghost'
            size='icon-sm'
            className='rounded-menu-item text-foreground hover:bg-white/10 not-disabled:hover:bg-white/10'
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <ArrowShrink02Icon /> : <ArrowExpand01Icon />}
          </Button>
        </div>
      }
      {actions && <MediaActions src={src ?? mediaUrl(video)} name={video.name} video />}
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
    <MediaSlider
      label='Seek'
      className='mx-2 flex-1'
      max={duration ?? 1}
      value={Math.min(time, duration ?? 0)}
      disabled={duration === undefined}
      onChange={(next) => {
        if (media.current) media.current.currentTime = next
        setTime(next)
      }}
    />
  )
}

// Short demos, so the volume starts at half; the slider slides out of the speaker on hover or focus.
function Volume({ media, muted }: { media: RefObject<HTMLVideoElement | null>; muted: boolean }) {
  const [volume, setVolume] = useState(0.5)
  useEffect(() => {
    if (media.current) media.current.volume = volume
  }, [media, volume])
  const silent = muted || volume === 0
  return (
    <div className='group/volume flex items-center'>
      <Button
        variant='ghost'
        size='icon-sm'
        className='rounded-menu-item text-foreground hover:bg-white/10 not-disabled:hover:bg-white/10'
        aria-label={silent ? 'Unmute' : 'Mute'}
        onClick={() => {
          const element = media.current
          if (!element) return
          if (!silent) element.muted = true
          else {
            if (volume === 0) setVolume(0.5)
            element.muted = false
          }
        }}
      >
        {silent ? <VolumeMute02Icon /> : <VolumeHighIcon />}
      </Button>
      <div className='w-0 overflow-hidden transition-[width] duration-150 group-has-[:focus-visible]/volume:w-18 group-hover/volume:w-18 motion-reduce:transition-none'>
        <MediaSlider
          label='Volume'
          className='mr-2 ml-1 w-15'
          max={1}
          value={silent ? 0 : volume}
          onChange={(next) => {
            setVolume(next)
            if (media.current) media.current.muted = next === 0
          }}
        />
      </div>
    </div>
  )
}

// A thin track and a small white tick, quieter than the app's slider on top of footage.
function MediaSlider({
  label,
  max,
  value,
  disabled,
  className,
  onChange,
}: {
  label: string
  max: number
  value: number
  disabled?: boolean
  className?: string
  onChange: (value: number) => void
}) {
  return (
    <SliderPrimitive.Root
      className={className}
      min={0}
      max={max}
      step={max / 100}
      value={value}
      disabled={disabled}
      thumbAlignment='edge'
      onValueChange={(next) => onChange(Array.isArray(next) ? next[0]! : next)}
    >
      <SliderPrimitive.Control className='relative flex h-5 w-full cursor-pointer touch-none items-center select-none'>
        <SliderPrimitive.Track className='relative h-1 w-full overflow-hidden rounded-full bg-white/20'>
          <SliderPrimitive.Indicator className='h-full bg-white/80' />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={label}
          className='block h-3 w-1 rounded-full bg-white outline-none focus-visible:ring-2 focus-visible:ring-white/50'
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
