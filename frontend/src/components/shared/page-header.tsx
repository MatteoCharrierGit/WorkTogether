import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Componente icona lucide o nodo già renderizzato */
  icon?: LucideIcon | React.ReactNode
  /** Bottoni/azioni a destra; su mobile vanno a capo sotto il titolo */
  actions?: React.ReactNode
  /** Riga sopra il titolo (es. <Breadcrumbs/>) */
  breadcrumb?: React.ReactNode
  /** Contenuto sotto il titolo (tabs, filtri, …) */
  children?: React.ReactNode
  /** Sotto md nasconde icona e titolo (restano per gli screen reader): la top bar mobile mostra già il titolo della sezione */
  hideTitleOnMobile?: boolean
  className?: string
}

function renderIcon(icon: PageHeaderProps['icon']) {
  if (!icon) return null
  if (React.isValidElement(icon)) return icon
  const Icon = icon as LucideIcon
  return <Icon className="h-4 w-4" aria-hidden="true" />
}

/** Intestazione standard di pagina. */
export function PageHeader({ title, description, icon, actions, breadcrumb, children, hideTitleOnMobile = false, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 pb-4 sm:pb-6', className)}>
      {breadcrumb && <div className="min-w-0 text-sm text-muted-foreground">{breadcrumb}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span
              className={cn(
                'mt-0.5 h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-surface-2 text-muted-foreground',
                hideTitleOnMobile ? 'hidden md:flex' : 'flex'
              )}
            >
              {renderIcon(icon)}
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <h1 className={cn('truncate text-title', hideTitleOnMobile && 'max-md:sr-only')}>{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
