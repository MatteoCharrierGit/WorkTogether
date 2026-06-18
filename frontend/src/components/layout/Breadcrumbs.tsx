import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TYPE_ICONS } from '@/lib/utils'

interface Crumb {
  label: string
  type?: string
  href?: string
}

interface BreadcrumbsProps {
  items: Crumb[]
  className?: string
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav className={cn('flex items-center gap-1 text-sm text-muted-foreground', className)} aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />}
          {item.type && <span className="text-xs">{TYPE_ICONS[item.type]}</span>}
          {item.href ? (
            <Link to={item.href} className="hover:text-foreground transition-colors truncate max-w-[140px]">
              {item.label}
            </Link>
          ) : (
            <span className={cn('truncate max-w-[140px]', i === items.length - 1 && 'text-foreground font-medium')}>
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}
