import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, CalendarClock, Check, ChevronsUpDown, CircleDashed, Clock, Flag, FolderTree,
  Plus, Tag as TagIcon, TriangleAlert, Users, Zap, Shapes, UserPen,
} from 'lucide-react'
import type { Element, ElementStatus, Member, Sprint, Tag } from '@/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  StatusBadge, StatusIcon, TagChip, TypeIcon, TYPE_META, UserAvatar, AvatarStack,
} from '@/components/shared'
import { cn, formatDate } from '@/lib/utils'
import type { ElementPatch } from './useElementAutosave'

const STATUSES: ElementStatus[] = ['DA_FARE', 'IN_CORSO', 'COMPLETATO', 'ARCHIVIATO']

// 'YYYY-MM-DD' -> ISO a mezzogiorno UTC (evita slittamenti di giorno per fuso orario)
const toIso = (d: string) => (d ? `${d}T12:00:00Z` : undefined)

function Row({ icon: Icon, label, children, align = 'center' }: { icon: React.ElementType; label: string; children: React.ReactNode; align?: 'center' | 'start' }) {
  return (
    <div className={cn('flex min-h-8 gap-2', align === 'center' ? 'items-center' : 'items-start')}>
      <div className={cn('flex w-28 shrink-0 items-center gap-1.5 text-sm text-muted-foreground', align === 'start' && 'pt-1.5')}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

const ghostTrigger =
  'focus-ring flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent'

export interface ElementPropertiesProps {
  element: Element
  wsId: string
  readOnly: boolean
  members: Member[]
  tags: Tag[]
  parent?: Element
  sprint?: Sprint
  creatorName?: string
  onPatch: (fields: ElementPatch, optimistic?: Partial<Element>) => void
  className?: string
}

/** Pannello proprietà (stato, assegnatari, tag, date, …) del dettaglio elemento. */
export function ElementProperties({
  element, wsId, readOnly, members, tags, parent, sprint, creatorName, onPatch, className,
}: ElementPropertiesProps) {
  const isEvent = element.type === 'EVENTO'
  const allDay = !!element.allDay
  const start = element.startDate?.slice(0, 10) ?? ''
  const end = element.endDate?.slice(0, 10) ?? ''

  const toggleAssignee = (userId: string) => {
    const has = element.assignees.some(a => a.id === userId)
    const next = has
      ? element.assignees.filter(a => a.id !== userId)
      : [
          ...element.assignees,
          (() => {
            const m = members.find(x => x.userId === userId)
            return { id: userId, displayName: m?.displayName ?? '', email: m?.email ?? '', avatar: m?.avatar } as Element['assignees'][number]
          })(),
        ]
    onPatch({ assigneeIds: next.map(a => a.id) }, { assignees: next })
  }

  const toggleTag = (tagId: string) => {
    const has = element.tags.some(t => t.id === tagId)
    const next = has ? element.tags.filter(t => t.id !== tagId) : [...element.tags, ...tags.filter(t => t.id === tagId)]
    onPatch({ tagIds: next.map(t => t.id) }, { tags: next })
  }

  return (
    <div className={cn('space-y-0.5', className)}>
      <Row icon={CircleDashed} label="Stato">
        {readOnly ? (
          <div className="px-2"><StatusBadge status={element.status} /></div>
        ) : (
          <Select value={element.status} onValueChange={v => onPatch({ status: v as ElementStatus }, { status: v as ElementStatus })}>
            <SelectTrigger aria-label="Stato" className="h-8 border-transparent bg-transparent px-2 shadow-none hover:bg-accent">
              <SelectValue>
                <StatusBadge status={element.status} />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  <span className="flex items-center gap-2"><StatusIcon status={s} size="sm" /> <StatusBadge status={s} icon={false} className="bg-transparent px-0" /></span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Row>

      <Row icon={Shapes} label="Tipo">
        <div className="flex items-center gap-1.5 px-2 text-sm">
          <TypeIcon type={element.type} size="sm" /> {TYPE_META[element.type]?.label ?? element.type}
        </div>
      </Row>

      {element.type !== 'EVENTO' && (
        <Row icon={TriangleAlert} label="Bloccante">
          <div className="flex items-center px-2">
            <Switch
              checked={!!element.blocked}
              disabled={readOnly}
              onCheckedChange={v => onPatch({ blocked: v }, { blocked: v })}
              aria-label="Segna come bloccante"
            />
          </div>
        </Row>
      )}

      <Row icon={Users} label="Assegnatari" align="start">
        <Popover>
          <PopoverTrigger asChild disabled={readOnly}>
            <button type="button" className={ghostTrigger} aria-label="Modifica assegnatari">
              {element.assignees.length ? (
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {element.assignees.length > 2 ? (
                    <>
                      <AvatarStack users={element.assignees} max={4} size="xs" />
                      <span className="text-muted-foreground">{element.assignees.length} persone</span>
                    </>
                  ) : (
                    element.assignees.map(a => (
                      <span key={a.id} className="flex min-w-0 items-center gap-1.5">
                        <UserAvatar name={a.displayName} avatar={a.avatar} size="xs" />
                        <span className="truncate">{a.displayName}</span>
                      </span>
                    ))
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">{readOnly ? 'Nessuno' : 'Assegna…'}</span>
              )}
              {!readOnly && <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput placeholder="Cerca membro…" />
              <CommandList>
                <CommandEmpty>Nessun membro trovato.</CommandEmpty>
                {members.map(m => {
                  const active = element.assignees.some(a => a.id === m.userId)
                  return (
                    <CommandItem key={m.userId} value={`${m.displayName} ${m.email}`} onSelect={() => toggleAssignee(m.userId)}>
                      <UserAvatar name={m.displayName} avatar={m.avatar} size="xs" />
                      <span className="flex-1 truncate">{m.displayName}</span>
                      {active && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                  )
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </Row>

      <Row icon={TagIcon} label="Tag" align="start">
        <Popover>
          <PopoverTrigger asChild disabled={readOnly}>
            <button type="button" className={ghostTrigger} aria-label="Modifica tag">
              {element.tags.length ? (
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {element.tags.map(t => <TagChip key={t.id} tag={t} size="sm" />)}
                </span>
              ) : (
                <span className="text-muted-foreground">{readOnly ? 'Nessun tag' : 'Aggiungi tag…'}</span>
              )}
              {!readOnly && <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput placeholder="Cerca tag…" />
              <CommandList>
                <CommandEmpty>{tags.length ? 'Nessun tag trovato.' : 'Nessun tag nel workspace.'}</CommandEmpty>
                {tags.map(t => {
                  const active = element.tags.some(x => x.id === t.id)
                  return (
                    <CommandItem key={t.id} value={t.name} onSelect={() => toggleTag(t.id)}>
                      <Checkbox checked={active} tabIndex={-1} aria-hidden="true" className="pointer-events-none" />
                      <TagChip tag={t} size="sm" />
                    </CommandItem>
                  )
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </Row>

      {isEvent && (
        <Row icon={Clock} label="Giornata intera">
          <div className="flex items-center px-2">
            <Switch
              checked={allDay}
              disabled={readOnly}
              onCheckedChange={v => onPatch({ allDay: v }, { allDay: v, ...(v ? { endDate: undefined } : {}) })}
              aria-label="Giornata intera"
            />
          </div>
        </Row>
      )}

      <Row icon={CalendarDays} label={isEvent && allDay ? 'Data' : 'Inizio'}>
        {readOnly ? (
          <span className="px-2 text-sm">{start ? formatDate(element.startDate) : <span className="text-muted-foreground">—</span>}</span>
        ) : (
          <Input
            type="date"
            aria-label={isEvent && allDay ? 'Data' : 'Data di inizio'}
            value={start}
            max={end || undefined}
            onChange={e => e.target.value && onPatch({ startDate: toIso(e.target.value) }, { startDate: toIso(e.target.value) })}
            className="h-8 border-transparent bg-transparent px-2 shadow-none hover:bg-accent"
          />
        )}
      </Row>

      {!(isEvent && allDay) && (
        <Row icon={CalendarClock} label={element.type === 'TASK' ? 'Scadenza' : 'Fine'}>
          {readOnly ? (
            <span className="px-2 text-sm">{end ? formatDate(element.endDate) : <span className="text-muted-foreground">—</span>}</span>
          ) : (
            <Input
              type="date"
              aria-label={element.type === 'TASK' ? 'Scadenza' : 'Data di fine'}
              value={end}
              min={start || undefined}
              onChange={e => e.target.value && onPatch({ endDate: toIso(e.target.value) }, { endDate: toIso(e.target.value) })}
              className="h-8 border-transparent bg-transparent px-2 shadow-none hover:bg-accent"
            />
          )}
        </Row>
      )}

      {parent && (
        <Row icon={FolderTree} label="Genitore">
          <Link
            to={`/workspace/${wsId}/element/${parent.id}`}
            className={cn(ghostTrigger, 'min-w-0')}
          >
            <TypeIcon type={parent.type} size="sm" />
            <span className="truncate">{parent.title}</span>
          </Link>
        </Row>
      )}

      {sprint && (
        <Row icon={Zap} label="Sprint">
          <Link to={`/workspace/${wsId}/sprint`} className={cn(ghostTrigger, 'min-w-0')}>
            <span className="truncate">{sprint.name}</span>
            {sprint.status === 'ACTIVE' && <span className="rounded-full bg-success-subtle px-1.5 text-2xs font-medium text-success">Attiva</span>}
          </Link>
        </Row>
      )}

      {element.type === 'EPICA' && element.progress != null && (
        <Row icon={Flag} label="Avanzamento">
          <div className="flex items-center gap-2 px-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${element.progress}%` }} />
            </div>
            <span className="text-caption tabular-nums text-muted-foreground">{element.progress}%</span>
          </div>
        </Row>
      )}

      <div className="mt-3 space-y-1 border-t pt-3 text-caption text-muted-foreground">
        {creatorName && (
          <p className="flex items-center gap-1.5"><UserPen className="h-3.5 w-3.5" aria-hidden="true" /> Creato da {creatorName}</p>
        )}
        <p className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Creato il {formatDate(element.createdAt)}</p>
        {element.updatedAt && (
          <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> Modificato il {formatDate(element.updatedAt)}</p>
        )}
      </div>
    </div>
  )
}
