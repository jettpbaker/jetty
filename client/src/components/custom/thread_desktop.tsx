import { desktopUrl } from '@/platform'
import { useDesktop, useOnline } from '@/state'

import { Loading } from './loading'

export const desktopLabels = {
  starting: 'Desktop starting',
  live: 'Live desktop',
  ended: 'Desktop ended',
}

// The streamer's own viewer, framed from Jetty's origin. It reloads after a reconnect, which is
// when a restarted server has a new secret for it.
export function ThreadDesktop({ id }: { id: string }) {
  const { state } = useDesktop(id)
  const online = useOnline()
  if (state === 'ended')
    return (
      <div className='flex h-full flex-col items-center justify-center gap-1 p-4 text-center'>
        <p className='text-sm'>Desktop ended</p>
        <p className='text-xs text-muted-foreground'>
          Its session isn't running any more. Ask the agent for a new one to look again.
        </p>
      </div>
    )
  if (state === 'starting') return <Loading label='Starting desktop' />
  if (!online) return <Loading label='Reconnecting' />
  return <iframe title='Desktop' src={desktopUrl(id)} className='size-full border-0' />
}
