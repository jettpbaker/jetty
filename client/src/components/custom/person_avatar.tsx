import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

function personInitials(login: string) {
  const parts = login.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const first = parts[0]
  const second = parts[1]
  if (first && second) return `${first[0]}${second[0]}`.toUpperCase()
  const letters = login.replace(/[^a-zA-Z0-9]/g, '')
  return letters.slice(0, 2).toUpperCase() || '?'
}

export function PersonAvatar({
  login,
  src,
  className,
}: {
  login: string
  src?: string
  className?: string
}) {
  return (
    <Avatar className={className} aria-hidden='true'>
      {src && <AvatarImage src={src} alt='' />}
      <AvatarFallback className='text-[9px] leading-none font-medium'>
        {personInitials(login)}
      </AvatarFallback>
    </Avatar>
  )
}
