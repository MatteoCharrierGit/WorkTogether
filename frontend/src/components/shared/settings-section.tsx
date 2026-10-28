import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** Sezione impostazioni: Card con titolo, descrizione e azioni opzionali. */
export function SettingsSection({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
  contentClassName,
  tone,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  contentClassName?: string
  tone?: 'danger'
}) {
  return (
    <Card className={cn(tone === 'danger' && 'border-destructive/40', className)}>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className={cn('flex items-center gap-2 text-sm', tone === 'danger' && 'text-destructive')}>
            {Icon && <Icon className={cn('h-4 w-4 shrink-0', tone === 'danger' ? 'text-destructive' : 'text-muted-foreground')} />}
            {title}
          </CardTitle>
          {description && <CardDescription className="text-caption">{description}</CardDescription>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      {children && <CardContent className={contentClassName}>{children}</CardContent>}
    </Card>
  )
}

/** Riga impostazione: etichetta + descrizione a sinistra, controllo a destra. */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0', className)}>
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={htmlFor} className="block cursor-pointer text-sm font-medium leading-snug">
          {label}
        </label>
        {description && <p className="text-caption text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
