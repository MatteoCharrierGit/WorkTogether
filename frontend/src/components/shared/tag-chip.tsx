import * as React from 'react'
import { X } from 'lucide-react'
import type { Tag } from '@/types'
import { cn, tintVars } from '@/lib/utils'

export interface TagChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** Tag completo oppure name+color separati */
  tag?: Pick<Tag, 'name' | 'color'>
  name?: string
  color?: string
  size?: 'sm' | 'default'
  /** "tinted": sfondo tenue del colore del tag; "dot": chip neutro con pallino colorato */
  variant?: 'tinted' | 'dot'
  /** Se presente mostra una × per rimuovere il tag */
  onRemove?: () => void
}

/** Chip di un tag: colore derivato dall'hex del tag con contrasto leggibile in chiaro e scuro. */
export function TagChip({ tag, name, color, size = 'default', variant = 'tinted', onRemove, className, style, ...props }: TagChipProps) {
  const label = tag?.name ?? name ?? ''
  const hex = tag?.color ?? color
  const vars = tintVars(hex)
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full font-medium',
        size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-xs',
        variant === 'tinted' ? 'tinted' : 'border bg-background text-foreground',
        className
      )}
      style={{ ...vars, ...style }}
      {...props}
    >
      {variant === 'dot' && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hex || 'hsl(var(--muted-foreground))' }} aria-hidden="true" />
      )}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Rimuovi tag ${label}`}
          className="-mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

/** Lista di tag con limite e "+N". */
export function TagList({ tags, max = 4, size = 'sm', className }: { tags: Pick<Tag, 'id' | 'name' | 'color'>[]; max?: number; size?: 'sm' | 'default'; className?: string }) {
  if (!tags.length) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map(t => (
        <TagChip key={t.id} tag={t} size={size} />
      ))}
      {rest > 0 && (
        <span className={cn('inline-flex items-center rounded-full bg-muted px-1.5 font-medium text-muted-foreground', size === 'sm' ? 'h-5 text-2xs' : 'h-6 text-xs')} title={tags.slice(max).map(t => t.name).join(', ')}>
          +{rest}
        </span>
      )}
    </div>
  )
}
