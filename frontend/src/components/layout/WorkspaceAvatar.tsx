import * as React from 'react'
import { cn, hueFromString } from '@/lib/utils'

const SIZES = {
  sm: 'h-5 w-5 rounded text-2xs',
  md: 'h-7 w-7 rounded-md text-xs',
  lg: 'h-10 w-10 rounded-lg text-sm',
} as const

/** Logo del workspace: immagine se presente, altrimenti iniziale su sfondo tinto deterministico. */
export function WorkspaceAvatar({
  name,
  avatar,
  size = 'md',
  className,
}: {
  name?: string
  avatar?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  if (avatar) {
    return <img src={avatar} alt="" className={cn('shrink-0 object-cover', SIZES[size], className)} />
  }
  return (
    <span
      aria-hidden="true"
      className={cn('tinted inline-flex shrink-0 items-center justify-center font-semibold', SIZES[size], className)}
      style={{ ['--tint-h' as string]: String(hueFromString(name || 'W')), ['--tint-s' as string]: '55%' } as React.CSSProperties}
    >
      {(name?.trim()[0] ?? 'W').toUpperCase()}
    </span>
  )
}
