import { cn } from '@/lib/utils'

// Custom: eight bars fading behind the leader as it steps round, the iOS and Geist spinner. No icon
// pack draws one. It holds still under reduced motion.
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      data-slot='spinner'
      role='status'
      aria-label='Loading'
      viewBox='0 0 16 16'
      fill='none'
      className={cn(
        'size-4 animate-[spin_0.8s_steps(8)_infinite] motion-reduce:animate-none',
        className
      )}
      {...props}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <path
          key={index}
          d='M8 1.75v2.5'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
          opacity={(index + 1) / 8}
          transform={`rotate(${index * 45} 8 8)`}
        />
      ))}
    </svg>
  )
}

export { Spinner }
