import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/styleguide')({
  component: StyleguidePage,
})

function StyleguidePage() {
  return <div className='h-full overflow-y-auto' />
}
