import { PauseIcon, PlayIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pressProps } from '@/lib/press'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

export type PreviewManifest = {
  version: 1
  recordingId: string
  title: string
  src: string
  fps: number
  frameCount: number
  duration: number
  width: number
  height: number
  capturedAt: string
  sourceRevision: string
}

function timecode(frame: number, fps: number) {
  const seconds = Math.floor(frame / fps)
  const parts = [Math.floor(seconds / 60), seconds % 60, frame % fps]
  return parts.map((part) => String(part).padStart(2, '0')).join(':')
}

export function RecordedPreview({ preview }: { preview: PreviewManifest }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const requestedFrame = useRef(0)
  const seeking = useRef(false)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1)
  const lastFrame = Math.max(0, preview.frameCount - 1)

  const seek = useCallback(
    (next: number) => {
      const video = videoRef.current
      if (!video || video.readyState === 0) return
      const target = Math.max(0, Math.min(lastFrame, Math.round(next)))
      video.pause()
      requestedFrame.current = target
      seeking.current = true
      setFrame(target)
      video.currentTime = Math.min((target + 0.5) / preview.fps, preview.duration)
    },
    [lastFrame, preview.fps, preview.duration]
  )

  const togglePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video || !ready || error) return
    if (!video.paused) {
      video.pause()
      return
    }
    if (video.ended || requestedFrame.current >= lastFrame) seek(0)
    void video.play().catch(() => setPlaying(false))
  }, [ready, error, lastFrame, seek])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = speed
  }, [speed])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let callback = 0
    let cancelled = false
    function update(nextFrame: number) {
      if (seeking.current || video!.seeking) return
      const next = Math.max(0, Math.min(lastFrame, nextFrame))
      requestedFrame.current = next
      setFrame(next)
    }
    function onFrame(_now: number, metadata: VideoFrameCallbackMetadata) {
      if (cancelled) return
      update(Math.round(metadata.mediaTime * preview.fps))
      callback = video!.requestVideoFrameCallback(onFrame)
    }
    function onAnimationFrame() {
      if (cancelled) return
      update(Math.floor(video!.currentTime * preview.fps))
      callback = requestAnimationFrame(onAnimationFrame)
    }
    const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function'
    callback = hasFrameCallback
      ? video.requestVideoFrameCallback(onFrame)
      : requestAnimationFrame(onAnimationFrame)
    return () => {
      cancelled = true
      if (hasFrameCallback) video.cancelVideoFrameCallback(callback)
      else cancelAnimationFrame(callback)
    }
  }, [lastFrame, preview.fps])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (
        !ready ||
        error ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest(
              'input:not([data-preview-timeline]), textarea, select, [role="textbox"]'
            )))
      )
        return
      let next: number | undefined
      switch (event.key) {
        case ' ':
          event.preventDefault()
          event.stopPropagation()
          if (!event.repeat) togglePlayback()
          return
        case ',':
        case '<':
          next = requestedFrame.current - 1
          break
        case '.':
        case '>':
          next = requestedFrame.current + 1
          break
        case 'ArrowLeft':
          next = requestedFrame.current - preview.fps * (event.shiftKey ? 5 : 1)
          break
        case 'ArrowRight':
          next = requestedFrame.current + preview.fps * (event.shiftKey ? 5 : 1)
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = lastFrame
          break
        default:
          return
      }
      event.preventDefault()
      event.stopPropagation()
      seek(next)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [ready, error, preview.fps, lastFrame, seek, togglePlayback])

  function scrub(event: PointerEvent<HTMLInputElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    seek(((event.clientX - bounds.left) / bounds.width) * lastFrame)
  }

  const progress = lastFrame === 0 ? 0 : frame / lastFrame
  const ticks = Array.from({ length: 11 }, (_, index) => Math.round((lastFrame * index) / 10))

  return (
    <div className='flex min-h-0 flex-1 flex-col bg-background text-foreground'>
      <div className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden'>
        <video
          ref={videoRef}
          src={`${preview.src}${preview.src.includes('?') ? '&' : '?'}capture=${encodeURIComponent(preview.capturedAt)}`}
          aria-label={preview.title}
          className='size-full object-contain'
          width={preview.width}
          height={preview.height}
          preload='auto'
          muted
          playsInline
          onLoadedData={() => {
            setReady(true)
            setError(null)
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onSeeked={() => {
            const video = videoRef.current
            if (video && !video.seeking) seeking.current = false
          }}
          onEnded={() => {
            requestedFrame.current = lastFrame
            setFrame(lastFrame)
            setPlaying(false)
          }}
          onError={() => {
            setPlaying(false)
            setError('Preview could not load. Recapture the recording and reload this page.')
          }}
        />
        {(!ready || error) && (
          <output className='absolute rounded-md bg-background px-4 py-2 text-sm text-muted-foreground'>
            {error ?? 'Loading preview…'}
          </output>
        )}
      </div>
      <Separator />
      <div className='flex shrink-0 flex-col gap-2 px-4 py-3'>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Previous frame (<)'
              title='Previous frame (<)'
              disabled={!ready || !!error}
              {...pressProps(() => seek(requestedFrame.current - 1))}
            >
              <span aria-hidden='true'>&lt;</span>
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
              title='Play / pause (Space)'
              disabled={!ready || !!error}
              {...pressProps(togglePlayback)}
            >
              {playing ? <PauseIcon filled /> : <PlayIcon filled />}
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Next frame (>)'
              title='Next frame (>)'
              disabled={!ready || !!error}
              {...pressProps(() => seek(requestedFrame.current + 1))}
            >
              <span aria-hidden='true'>&gt;</span>
            </Button>
          </div>
          <output className='font-mono text-xs tabular-nums' aria-label='Current timecode'>
            {timecode(frame, preview.fps)}{' '}
            <span className='text-muted-foreground'>/ {timecode(lastFrame, preview.fps)}</span>
          </output>
          <output className='text-xs' aria-label='Current frame' title='Zero-based frame number'>
            <span className='text-muted-foreground'>Frame </span>
            <span className='font-mono tabular-nums'>{frame}</span>
          </output>
          <ToggleGroup
            aria-label='Playback speed'
            value={[String(speed)]}
            size='sm'
            spacing={0}
            onValueChange={(values) => {
              if (values[0]) setSpeed(Number(values[0]))
            }}
            className='ml-auto'
          >
            {[0.25, 0.5, 1, 2].map((rate) => (
              <ToggleGroupItem
                key={rate}
                value={String(rate)}
                aria-label={`${rate} times speed`}
                onPointerDown={(event) => {
                  if (event.button === 0) setSpeed(rate)
                }}
              >
                {rate}×
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className='relative h-14 touch-none select-none rounded-sm border border-border bg-muted/30 focus-within:ring-2 focus-within:ring-ring'>
          <input
            type='range'
            data-preview-timeline
            min={0}
            max={lastFrame}
            step={1}
            value={frame}
            disabled={!ready || !!error}
            aria-label='Preview timeline'
            aria-valuetext={`Frame ${frame} · ${timecode(frame, preview.fps)}`}
            className='absolute inset-0 size-full cursor-ew-resize opacity-0'
            onChange={(event) => seek(Number(event.currentTarget.value))}
            onPointerDown={(event) => {
              if (event.button !== 0 || !ready || error) return
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              scrub(event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event)
            }}
            onPointerUp={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              scrub(event)
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
          />
          <div
            className='pointer-events-none absolute inset-x-2 top-1 flex justify-between font-mono text-[10px] text-muted-foreground'
            aria-hidden='true'
          >
            {ticks.map((tick, index) => (
              <span
                key={index}
                className={
                  index % 2
                    ? 'hidden flex-col items-center gap-1 sm:flex'
                    : 'flex flex-col items-center gap-1'
                }
              >
                <span>{timecode(tick, preview.fps)}</span>
                <span className='h-2 w-px bg-border' />
              </span>
            ))}
          </div>
          <div
            className='pointer-events-none absolute inset-x-0 bottom-0 h-4 border-t border-border bg-muted'
            aria-hidden='true'
          />
          <div
            className='pointer-events-none absolute inset-y-0 w-px bg-primary'
            style={{ left: `${progress * 100}%` }}
            aria-hidden='true'
          >
            <span className='absolute top-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-primary' />
          </div>
        </div>
        <p className='text-xs text-muted-foreground'>
          Space play/pause · &lt; &gt; frame · ← → skip 1s · Shift ← → skip 5s
        </p>
      </div>
    </div>
  )
}
