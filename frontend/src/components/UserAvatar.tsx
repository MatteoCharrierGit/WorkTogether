import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'

interface Props {
  name?: string
  avatar?: string
  className?: string
  fallbackClassName?: string
}

// Avatar che mostra la foto profilo se presente, altrimenti le iniziali.
export function UserAvatar({ name = 'U', avatar, className, fallbackClassName }: Props) {
  return (
    <Avatar className={className}>
      {avatar && <AvatarImage src={avatar} alt={name} />}
      <AvatarFallback className={cn('text-xs', fallbackClassName)}>{getInitials(name)}</AvatarFallback>
    </Avatar>
  )
}
