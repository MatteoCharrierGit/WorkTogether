import * as React from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CalloutVariant = 'info' | 'success' | 'warning' | 'destructive' | 'neutral'

const STYLES: Record<CalloutVariant, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'bg-info-subtle border-info/20', icon: 'text-info', Icon: Info },
  success: { box: 'bg-success-subtle border-success/20', icon: 'text-success', Icon: CircleCheck },
  warning: { box: 'bg-warning-subtle border-warning/25', icon: 'text-warning', Icon: TriangleAlert },
  destructive: { box: 'bg-destructive-subtle border-destructive/20', icon: 'text-destructive', Icon: CircleAlert },
  neutral: { box: 'bg-surface-2', icon: 'text-muted-foreground', Icon: Info },
}

export interface CalloutProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: CalloutVariant
  title?: React.ReactNode
  /** Icona personalizzata; false per nasconderla */
  icon?: LucideIcon | false
  /** Azioni a destra / sotto (es. bottone "Riprova") */
  action?: React.ReactNode
}

/** Riquadro informativo/di avviso inline. */
export function Callout({ variant = 'info', title, icon, action, className, children, ...props }: CalloutProps) {
  const s = STYLES[variant]
  const Icon = icon === false ? null : icon ?? s.Icon
  return (
    <div
      role={variant === 'destructive' || variant === 'warning' ? 'alert' : 'status'}
      className={cn('flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-start', s.box, className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 gap-2.5">
        {Icon && <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', s.icon)} aria-hidden="true" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          {title && <p className="font-medium text-foreground">{title}</p>}
          {children && <div className="text-foreground/80">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">{action}</div>}
    </div>
  )
}
