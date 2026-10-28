import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { resolveAvatarSrc } from '@/components/shared/user-avatar'
import { getInitials, cn } from '@/lib/utils'

interface Props {
  name?: string
  /** URL versionato della foto (`/api/users/{id}/avatar?v=N`). */
  avatarUrl?: string | null
  /** Legacy: URL o data URL. */
  avatar?: string | null
  className?: string
  fallbackClassName?: string
}

/** @deprecated Usa `UserAvatar` da `@/components/shared`. Foto profilo se presente, altrimenti le iniziali. */
export function UserAvatar({ name = 'U', avatarUrl, avatar, className, fallbackClassName }: Props) {
  const src = resolveAvatarSrc(avatarUrl, avatar)
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback className={cn('text-xs', fallbackClassName)}>{getInitials(name)}</AvatarFallback>
    </Avatar>
  )
}
