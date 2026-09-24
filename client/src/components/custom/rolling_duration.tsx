import { RollingNumber } from './rolling_number'
import { formatActivityDuration } from './work_model'

export function RollingDuration({ seconds }: { seconds: number }) {
  const parts = (formatActivityDuration(seconds) ?? '0s').split(' ')
  return (
    <span className='inline-flex items-baseline gap-1'>
      {parts.map((part) => {
        const unit = part.slice(-1)
        return (
          <span key={unit} className='inline-flex items-baseline'>
            <RollingNumber value={Number(part.slice(0, -1))} />
            {unit}
          </span>
        )
      })}
    </span>
  )
}
