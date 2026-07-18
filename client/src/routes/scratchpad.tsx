import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/scratchpad')({
  component: ScratchpadPage,
})

// Design-pass playground: throwaway experiments only, nothing routes here.
function ScratchpadPage() {
  return <div className='h-full' />
}
