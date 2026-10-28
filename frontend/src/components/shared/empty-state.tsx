import * as React from 'react'
import { Inbox, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon?: LucideIcon | React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Azione principale (es. <Button>Crea</Button>) */
  action?: React.ReactNode
  /** "sm" per riquadri piccoli (colonne, popover) */
  size?: 'sm' | 'md'
  /** Bordo tratteggiato attorno */
  bordered?: boolean
  className?: string
}

/** Stato vuoto con icona, titolo, descrizione e azione. */
export function EmptyState({ icon = Inbox, title, description, action, size = 'md', bordered = false, className }: EmptyStateProps) {
  const Icon = icon as LucideIcon
  const iconNode = React.isValidElement(icon) ? icon : <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        bordered && 'rounded-lg border border-dashed',
        className
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-lg border bg-surface-2 text-muted-foreground',
          size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
        )}
      >
        {iconNode}
      </span>
      <div className="max-w-sm space-y-1">
        <p className={cn('font-medium text-foreground', size === 'sm' ? 'text-sm' : 'text-heading')}>{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}
