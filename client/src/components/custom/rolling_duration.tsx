import { RollingNumber } from './rolling_number'
import { formatActivityDuration } from './work_model'

// Still renders the same digits without the rolling setup, for a first frame that has to be cheap.
export function RollingDuration({ seconds, still = false }: { seconds: number; still?: boolean }) {
  const parts = (formatActivityDuration(seconds) ?? '0s').split(' ')
  return (
    <span className='inline-flex items-baseline gap-1'>
      {parts.map((part) => {
        const unit = part.slice(-1)
        const value = Number(part.slice(0, -1))
        return (
          <span key={unit} className='inline-flex items-baseline'>
            {still ? (
              <span className='inline-block tabular-nums'>{value}</span>
            ) : (
              <RollingNumber value={value} />
            )}
            {unit}
          </span>
        )
      })}
    </span>
  )
}
