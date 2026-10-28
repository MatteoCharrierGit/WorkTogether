import * as React from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import type { ElementPriority, ElementStatus, ElementType, Tag } from '@/types'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import { BlockedBadge, PriorityIndicator, StatusIcon, TypeIcon } from './element-meta'
import { TagList } from './tag-chip'
import { AvatarStack } from './user-avatar'

export interface TaskCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  /** Link interno (react-router) al dettaglio */
  href?: string
  type?: ElementType
  status?: ElementStatus
  /** Mostra l'icona di stato prima del titolo (utile fuori dal Kanban) */
  showStatus?: boolean
  /** Mostra l'icona del tipo prima del titolo */
  showType?: boolean
  tags?: Pick<Tag, 'id' | 'name' | 'color'>[]
  assignees?: { id: string; displayName: string; avatar?: string | null }[]
  maxAssignees?: number
  dueDate?: string | null
  blocked?: boolean
  /** Priorità: icona accanto al titolo (alta/urgente anche come badge) */
  priority?: ElementPriority | null
  /** Card attenuata (task completato) */
  muted?: boolean
  /** Stato visivo durante il drag */
  dragging?: boolean
  /** Azioni in alto a destra (es. <IconButton/>): in hover/focus con il mouse, sempre visibili su touch */
  actions?: React.ReactNode
  /** Slot in fondo alla card (es. select di stato nella Sprint) */
  footer?: React.ReactNode
  density?: 'default' | 'compact'
}

/**
 * Card presentazionale di un task (Kanban, Sprint, liste).
 * Nessuna logica dati: drag&drop, permessi e mutazioni restano nella pagina.
 * forwardRef + props HTML passate al div radice, quindi compatibile con @hello-pangea/dnd.
 */
export const TaskCard = React.forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  {
    title,
    href,
    type,
    status,
    showStatus = false,
    showType = false,
    tags = [],
    assignees = [],
    maxAssignees = 3,
    dueDate,
    blocked = false,
    priority,
    muted,
    dragging = false,
    actions,
    footer,
    density = 'default',
    className,
    ...props
  },
  ref
) {
  const done = status === 'COMPLETATO'
  const isMuted = muted ?? done
  const overdue = !done && isOverdue(dueDate)
  const showMeta = !!dueDate || assignees.length > 0

  const titleNode = href ? (
    <Link
      to={href}
      onClick={e => e.stopPropagation()}
      className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-lg hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      {title}
    </Link>
  ) : (
    title
  )

  return (
    <div
      ref={ref}
      className={cn(
        'group relative rounded-lg border bg-card text-card-foreground shadow-xs transition-[box-shadow,border-color,opacity]',
        density === 'compact' ? 'space-y-1.5 p-2.5' : 'space-y-2 p-3',
        'hover:border-border-strong',
        dragging && 'rotate-[0.5deg] border-ring/40 shadow-lg',
        blocked && !done && 'border-destructive/40',
        isMuted && !dragging && 'opacity-70 hover:opacity-100',
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-1.5">
        {showStatus && status && <StatusIcon status={status} size="sm" className="mt-0.5" />}
        {showType && type && <TypeIcon type={type} size="sm" className="mt-0.5" />}
        {priority && priority !== 'NONE' && !done && <PriorityIndicator priority={priority} size="default" className="mt-0.5" />}
        <div className={cn('min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-2', done && 'text-muted-foreground')}>{titleNode}</div>
        {actions && (
          <div className="relative z-[1] -mr-1 -mt-1 flex shrink-0 items-center opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
            {actions}
          </div>
        )}
      </div>

      {(blocked || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {blocked && !done && <BlockedBadge size="sm" />}
          {tags.length > 0 && <TagList tags={tags} max={3} size="sm" />}
        </div>
      )}

      {showMeta && (
        <div className="flex items-center justify-between gap-2">
          {dueDate ? (
            <span className={cn('inline-flex items-center gap-1 text-2xs', overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              <CalendarDays className="h-3 w-3" aria-hidden="true" />
              <span>{formatDate(dueDate)}</span>
              {overdue && <span className="sr-only">(scaduto)</span>}
            </span>
          ) : (
            <span />
          )}
          {assignees.length > 0 && <AvatarStack users={assignees} max={maxAssignees} size="xs" />}
        </div>
      )}

      {footer && <div className="relative z-[1]">{footer}</div>}
    </div>
  )
})
