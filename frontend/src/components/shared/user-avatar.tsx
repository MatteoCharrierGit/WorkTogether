import * as React from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn, getInitials, hueFromString } from '@/lib/utils'

const SIZES = {
  xs: { box: 'h-5 w-5', text: 'text-2xs', dot: 'h-1.5 w-1.5' },
  sm: { box: 'h-6 w-6', text: 'text-2xs', dot: 'h-2 w-2' },
  md: { box: 'h-8 w-8', text: 'text-xs', dot: 'h-2.5 w-2.5' },
  lg: { box: 'h-10 w-10', text: 'text-sm', dot: 'h-3 w-3' },
  xl: { box: 'h-16 w-16', text: 'text-xl', dot: 'h-3.5 w-3.5' },
} as const

export type Presence = 'online' | 'away' | 'busy' | 'offline'

const PRESENCE_CLASS: Record<Presence, string> = {
  online: 'bg-success',
  away: 'bg-warning',
  busy: 'bg-destructive',
  offline: 'bg-muted-foreground/50',
}
const PRESENCE_LABEL: Record<Presence, string> = {
  online: 'Online',
  away: 'Assente',
  busy: 'Occupato',
  offline: 'Offline',
}

/**
 * Sorgente dell'immagine: `avatarUrl` (URL versionato `/api/users/{id}/avatar?v=N`, cache HTTP)
 * oppure il legacy `avatar` (oggi stesso URL; un vecchio data URL base64 funziona ancora).
 * Con `VITE_API_URL` (API su altra origine) i path relativi `/api/...` vengono riscritti.
 */
export function resolveAvatarSrc(avatarUrl?: string | null, avatar?: string | null): string | undefined {
  const src = avatarUrl || avatar
  if (!src) return undefined
  const base = import.meta.env.VITE_API_URL as string | undefined
  if (base && src.startsWith('/api/')) return base.replace(/\/$/, '') + src.slice(4)
  return src
}

export interface UserAvatarProps {
  name?: string
  /** URL della foto (preferito). */
  avatarUrl?: string | null
  /** Legacy: URL o data URL. */
  avatar?: string | null
  size?: keyof typeof SIZES
  /** Pallino di presenza in basso a destra */
  presence?: Presence | boolean
  className?: string
  /** Anello per separare avatar sovrapposti (AvatarStack) */
  ring?: boolean
}

/** Avatar utente: foto se presente, altrimenti iniziali su sfondo tinto deterministico. */
export function UserAvatar({ name = 'Utente', avatarUrl, avatar, size = 'md', presence, className, ring }: UserAvatarProps) {
  const s = SIZES[size]
  const src = resolveAvatarSrc(avatarUrl, avatar)
  const p: Presence | null = presence === true ? 'online' : presence === false || presence == null ? null : presence
  const hue = hueFromString(name)
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={cn(s.box, 'bg-background', ring && 'ring-2 ring-background')}>
        {src && <AvatarImage src={src} alt={name} decoding="async" />}
        <AvatarFallback
          className={cn('tinted font-semibold', s.text)}
          style={{ ['--tint-h' as string]: String(hue), ['--tint-s' as string]: '55%' } as React.CSSProperties}
          title={name}
        >
          {/* A 20px due iniziali non stanno: si mostra solo la prima (il nome completo resta nel title). */}
          {size === 'xs' ? getInitials(name || '?').slice(0, 1) : getInitials(name || '?')}
        </AvatarFallback>
      </Avatar>
      {p && (
        <span
          className={cn('absolute bottom-0 right-0 rounded-full ring-2 ring-background', s.dot, PRESENCE_CLASS[p])}
          role="img"
          aria-label={PRESENCE_LABEL[p]}
        />
      )}
    </span>
  )
}

// Sovrapposizione per taglia: non deve coprire le iniziali dell'avatar precedente.
const STACK_OVERLAP: Record<keyof typeof SIZES, string> = {
  xs: '-space-x-1',
  sm: '-space-x-0.5',
  md: '-space-x-1.5',
  lg: '-space-x-2',
  xl: '-space-x-3',
}

/** Avatar sovrapposti con "+N". */
export function AvatarStack({
  users,
  max = 3,
  size = 'sm',
  className,
}: {
  users: { id: string; displayName: string; avatar?: string | null; avatarUrl?: string | null }[]
  max?: number
  size?: keyof typeof SIZES
  className?: string
}) {
  if (!users.length) return null
  const shown = users.slice(0, max)
  const rest = users.length - shown.length
  return (
    <div
      role="group"
      className={cn('flex items-center', STACK_OVERLAP[size], className)}
      aria-label={users.map(u => u.displayName).join(', ')}
      title={users.map(u => u.displayName).join(', ')}
    >
      {shown.map(u => (
        <UserAvatar key={u.id} name={u.displayName} avatarUrl={u.avatarUrl} avatar={u.avatar} size={size} ring />
      ))}
      {rest > 0 && (
        <span className={cn('relative inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background', SIZES[size].box, SIZES[size].text)}>
          +{rest}
        </span>
      )}
    </div>
  )
}
