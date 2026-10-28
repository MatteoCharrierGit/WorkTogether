import * as React from 'react'
import { cn } from '@/lib/utils'

/** Tasto/scorciatoia da tastiera: <Kbd>⌘K</Kbd> */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded border border-b-2 bg-muted px-1 font-mono text-2xs font-medium text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}
