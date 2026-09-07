import type { ThreadItem } from '@jetty/shared/items'

export function VideoItem({ item }: { item: Extract<ThreadItem, { kind: 'video' }> }) {
  return (
    <div>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- agent screen recordings have no caption track */}
      <video
        controls
        preload='metadata'
        playsInline
        src={`/attachments/${item.video.id}`}
        title={item.video.name}
        className='max-h-96 w-full rounded-md border bg-black'
      />
      {item.caption ? <p className='mt-2 text-sm text-muted-foreground'>{item.caption}</p> : null}
    </div>
  )
}
