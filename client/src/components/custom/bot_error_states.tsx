import { cn } from '@/lib/utils'
import { useId, type CSSProperties } from 'react'

import {
  botColors,
  botShapes,
  deepBotColors,
  type Body,
  type BotColor,
  type BotShape,
} from './jetty_bot_shapes'
import './jetty_bot.css'
import './bot_error_states.css'

/* The Jetty bot's error state, drawn from its shape data: Needs you's badge in red and its eyes dropped. It
   deflates as the badge pops in, then every 7s it looks up at the badge and the badge boings, as if noticed. */

// Needs you's badge spot.
const BADGE_AT = { x: 77, y: 25 }

function BodyFill({ body }: { body: Body }) {
  if (body.d) return <path className='jb-body' d={body.d} />
  return (
    <g className='jb-body'>
      {body.circles!.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
    </g>
  )
}

// clipPath only takes shapes, so circles go in one by one.
function BodyClip({ body }: { body: Body }) {
  if (body.d) return <path d={body.d} />
  return (
    <>
      {body.circles!.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
    </>
  )
}

type ErrorBotProps = {
  /** Seconds to offset the repeating look, so bots side by side don't move in step. */
  phase?: number
  shape?: BotShape
  color?: BotColor
  size?: number
  className?: string
}

export function ErrorBot({
  phase = 0,
  shape = 'circle',
  color = 'lilac',
  size = 40,
  className,
}: ErrorBotProps) {
  const id = `eb${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const body = botShapes[shape]
  // As in JettyBot, small avatars get bigger eyes so the face still reads.
  const boost = size <= 24 ? 1.3 : size <= 32 ? 1.14 : 1
  const face = { ...body.face, s: body.face.s * boost }
  return (
    <svg
      viewBox='0 0 100 100'
      width={size}
      height={size}
      aria-hidden
      className={cn('jb eb', className)}
      data-color={color}
      style={
        {
          '--jb-body': botColors[color],
          '--jb-deep': deepBotColors[color],
          '--eb-phase': `${phase}s`,
        } as CSSProperties
      }
    >
      <defs>
        <clipPath id={`${id}-face`}>
          <BodyClip body={body} />
        </clipPath>
      </defs>
      <g className='eb-body'>
        <BodyFill body={body} />
        <g clipPath={`url(#${id}-face)`}>
          <g transform={`translate(${face.x} ${face.y}) scale(${face.s})`}>
            {/* Shorter and lower than idle's eyes: it looks down. */}
            <g className='eb-face'>
              {[-10, 10].map((x) => (
                <rect
                  key={x}
                  className='jb-eye'
                  x={x - 3.8}
                  y={-3.2}
                  width={7.6}
                  height={12.4}
                  rx={3.8}
                />
              ))}
            </g>
          </g>
        </g>
      </g>
      <g transform={`translate(${BADGE_AT.x} ${BADGE_AT.y})`}>
        <g className='eb-badge'>
          <g className='eb-pop'>
            <circle r='14' className='jb-badge-ring' />
            <circle r='10.5' className='eb-red' />
            {/* Below 40px the ✕ smudges into a ring, so small badges are a plain dot. */}
            {size >= 40 && <path className='eb-cut' d='M-3.6 -3.6 L3.6 3.6 M3.6 -3.6 L-3.6 3.6' />}
          </g>
        </g>
      </g>
    </svg>
  )
}
