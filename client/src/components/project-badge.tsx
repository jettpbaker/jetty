// A project's first letter as a ransom-note cutout — one fixed sprite per
// letter (deterministic, unlike the wordmark). Falls back to a mono letter
// for anything without a cutout (digits, symbols, missing projects).

const badgeUrls = import.meta.glob('../assets/ransom-badge/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>

export function ProjectBadge({ title }: { title: string }) {
  const letter = title[0]?.toUpperCase() ?? '?'
  const url = badgeUrls[`../assets/ransom-badge/${letter}.webp`]
  if (!url) {
    return (
      <span className='pointer-events-none relative font-mono text-[11px] text-muted-foreground uppercase'>
        {letter}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=''
      draggable={false}
      className='pointer-events-none relative h-4 w-auto shrink-0 select-none'
    />
  )
}
