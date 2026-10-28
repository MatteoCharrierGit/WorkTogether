import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import type { Element } from '@/types'
import { cn, isOverdue, tintVars } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import { AvatarStack, StatusIcon, TagChip, TypeIcon } from '@/components/shared'
import type { CalendarItem } from './calendar-utils'

export interface ChipActions {
  canDelete: (el: Pick<Element, 'type' | 'createdBy'>) => boolean
  onDelete: (el: Element) => void
}

const href = (el: Element) => `/workspace/${el.workspaceId}/element/${el.id}`

/** Colore dell'evento: primo tag (tinta leggibile) oppure accento. */
function eventTone(el: Element) {
  const tag = el.tags?.[0]
  return tag
    ? { className: 'tinted', style: tintVars(tag.color) }
    : { className: 'bg-primary/10 text-primary', style: undefined }
}

const isDone = (el: Element) => el.status === 'COMPLETATO' || el.status === 'ARCHIVIATO'

/** Chip compatto per le celle del mese/settimana. */
export const CalendarChip = memo(function CalendarChip({
  item,
  canDelete,
  onDelete,
}: { item: CalendarItem } & ChipActions) {
  const { el } = item
  const tone = item.kind === 'event' ? eventTone(el) : null
  const done = isDone(el)
  const overdue = item.kind === 'task' && !done && isOverdue(el.endDate)
  return (
    <div
      className={cn(
        'group/chip relative flex h-6 min-w-0 items-center gap-1 rounded-sm pl-1.5 pr-0.5 text-xs leading-none transition-colors',
        tone ? tone.className : 'border bg-card text-foreground hover:bg-accent',
        tone && 'hover:brightness-95 dark:hover:brightness-110',
        item.multiDay && !item.isStart && 'opacity-80'
      )}
      style={tone?.style}
      onClick={e => e.stopPropagation()}
    >
      {item.kind === 'task' && <StatusIcon status={el.status} size="xs" />}
      {item.time && <span className="shrink-0 tabular-nums opacity-80">{item.time}</span>}
      <Link
        to={href(el)}
        title={el.title}
        className={cn(
          'min-w-0 flex-1 truncate py-1 font-medium focus-visible:underline focus-visible:outline-none',
          done && 'text-muted-foreground line-through',
          overdue && 'text-destructive'
        )}
      >
        {el.title}
      </Link>
      {canDelete(el) && (
        <IconButton
          label={`Elimina "${el.title}"`}
          icon={<Trash2 />}
          size="xs"
          noTooltip
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            onDelete(el)
          }}
          className="h-5 w-5 shrink-0 text-current opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover/chip:opacity-100 [&_svg]:h-3 [&_svg]:w-3"
        />
      )}
    </div>
  )
})

/** Riga estesa (agenda, popover "+N altri", vista settimana su mobile). */
export const CalendarItemRow = memo(function CalendarItemRow({
  item,
  canDelete,
  onDelete,
}: { item: CalendarItem } & ChipActions) {
  const { el } = item
  const done = isDone(el)
  const overdue = item.kind === 'task' && !done && isOverdue(el.endDate)
  const tag = el.tags?.[0]

  let meta: string
  if (item.kind === 'task') meta = overdue ? 'Scaduto' : 'Scadenza'
  else if (el.allDay || !el.startDate) meta = item.multiDay ? 'Più giorni' : 'Tutto il giorno'
  else {
    const s = new Date(el.startDate)
    const e = el.endDate ? new Date(el.endDate) : null
    meta =
      e && !item.multiDay
        ? `${format(s, 'HH:mm')} – ${format(e, 'HH:mm')}`
        : item.isStart
          ? format(s, 'HH:mm')
          : `Fino al ${format(e ?? s, 'd MMM', { locale: it })}`
  }

  return (
    <div className="group/row flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
      {item.kind === 'event' ? (
        <span
          className={cn('h-6 w-1 shrink-0 rounded-full', tag ? 'tinted' : 'bg-primary')}
          style={tag ? { ...tintVars(tag.color), backgroundColor: 'var(--tint-solid)' } : undefined}
          aria-hidden="true"
        />
      ) : (
        <StatusIcon status={el.status} size="sm" className="mx-px" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          to={href(el)}
          className={cn(
            'block truncate text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none',
            done && 'text-muted-foreground line-through'
          )}
        >
          {el.title}
        </Link>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <TypeIcon type={el.type} size="xs" />
          <span className={cn('shrink-0 tabular-nums', overdue && 'text-destructive')}>{meta}</span>
          {tag && <TagChip tag={tag} size="sm" className="ml-0.5 min-w-0" />}
        </div>
      </div>
      {el.assignees?.length > 0 && <AvatarStack users={el.assignees} size="xs" max={3} className="hidden sm:flex" />}
      {canDelete(el) && (
        <IconButton
          label={`Elimina "${el.title}"`}
          icon={<Trash2 />}
          size="xs"
          onClick={() => onDelete(el)}
          className="shrink-0 hover:text-destructive sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover/row:opacity-100"
        />
      )}
    </div>
  )
})
