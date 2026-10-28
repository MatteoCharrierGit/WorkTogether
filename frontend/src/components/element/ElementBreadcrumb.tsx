import { Link } from 'react-router-dom'
import { ChevronRight, LayoutGrid } from 'lucide-react'
import { TypeIcon } from '@/components/shared'
import { cn } from '@/lib/utils'

export interface ElementCrumb {
  label: string
  type?: string
  href?: string
}

/** Breadcrumb del dettaglio elemento (workspace › epica › storia › elemento) con icone di tipo. */
export function ElementBreadcrumb({ items, className }: { items: ElementCrumb[]; className?: string }) {
  return (
    <nav aria-label="Percorso" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-0.5 text-sm text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1
          // Su mobile restano visibili solo l'ultimo antenato e la pagina corrente.
          const hideOnMobile = i < items.length - 2
          const content = (
            <>
              {i === 0 && !item.type ? (
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : item.type ? (
                <TypeIcon type={item.type} size="sm" />
              ) : null}
              <span className="truncate">{item.label || 'Senza titolo'}</span>
            </>
          )
          return (
            <li key={i} className={cn('flex min-w-0 items-center gap-0.5', hideOnMobile && 'hidden sm:flex', last ? 'shrink' : 'shrink-[2]')}>
              {i > 0 && <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 opacity-50', i === items.length - 2 && 'hidden sm:block')} aria-hidden="true" />}
              {item.href && !last ? (
                <Link
                  to={item.href}
                  className="focus-ring flex min-w-0 max-w-[12rem] items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent hover:text-foreground"
                >
                  {content}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn('flex min-w-0 max-w-[16rem] items-center gap-1.5 px-1.5 py-1', last && 'font-medium text-foreground')}>
                  {content}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
