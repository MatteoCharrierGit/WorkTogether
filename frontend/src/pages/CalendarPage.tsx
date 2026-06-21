import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Calendar, CheckSquare, Plus, Trash2 } from 'lucide-react'
import { useElementDelete } from '@/lib/useElementDelete'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  isSameMonth, isSameDay, isToday, format, addMonths, subMonths,
} from 'date-fns'
import { it } from 'date-fns/locale'
import { elementsApi } from '@/lib/api'
import { Element } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { CreateEventDialog } from '@/components/CreateEventDialog'

type Mode = 'events' | 'tasks'

// Confronto a granularità di giorno (ignora l'orario).
function dayInRange(day: Date, start: Date, end: Date): boolean {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  return d >= s && d <= e
}

function EventPill({ element }: { element: Element }) {
  const isEvent = element.type === 'EVENTO'
  const { canDelete, remove } = useElementDelete(element.workspaceId)
  return (
    <div
      className={cn(
        'group/pill flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-tight mb-0.5 transition-colors',
        isEvent
          ? 'bg-primary text-primary-foreground font-medium'
          : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 font-normal'
      )}
    >
      <a
        href={`/workspace/${element.workspaceId}/element/${element.id}`}
        onClick={e => e.stopPropagation()}
        className="flex-1 truncate"
        title={element.title}
      >
        {element.title}
      </a>
      {canDelete(element) && (
        <button
          onClick={e => { e.stopPropagation(); e.preventDefault(); remove(element) }}
          className="shrink-0 opacity-0 group-hover/pill:opacity-100 hover:text-destructive transition"
          title="Elimina"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export default function CalendarPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const workspace = useWorkspaceStore(s => s.current)
  const canCreate = workspace?.myRole !== 'GUEST'
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [mode, setMode] = useState<Mode>('events')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | undefined>()

  const { data: elements = [] } = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: !!wsId,
  })

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const getItemsForDay = (day: Date): Element[] => {
    return elements.filter(e => {
      if (mode === 'events') {
        if (e.type !== 'EVENTO' || !e.startDate) return false
        const start = new Date(e.startDate)
        const end = e.endDate ? new Date(e.endDate) : start
        return dayInRange(day, start, end)
      } else {
        if (e.type !== 'TASK' || !e.endDate) return false
        return isSameDay(new Date(e.endDate), day)
      }
    })
  }

  const openCreate = (day?: Date) => {
    if (!canCreate) return
    setSelectedDate(format(day ?? new Date(), 'yyyy-MM-dd'))
    setDialogOpen(true)
  }

  const weekDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Calendario</h1>
          <p className="text-xs text-muted-foreground">{workspace?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={mode} onValueChange={v => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="events" className="gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Eventi
              </TabsTrigger>
              <TabsTrigger value="tasks" className="gap-1.5">
                <CheckSquare className="h-3.5 w-3.5" /> Scadenze
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {canCreate && (
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="h-4 w-4 mr-1" /> Evento
            </Button>
          )}
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-sm font-semibold capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: it })}
        </h2>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-7 gap-px mb-1">
          {weekDays.map(d => (
            <div key={d} className="text-xs font-medium text-muted-foreground text-center py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
          {days.map(day => {
            const items = getItemsForDay(day)
            const inMonth = isSameMonth(day, currentMonth)
            const today = isToday(day)

            return (
              <div
                key={day.toISOString()}
                onClick={() => openCreate(day)}
                className={cn(
                  'min-h-[96px] bg-background p-1.5 group relative',
                  !inMonth && 'bg-muted/30',
                  canCreate && 'cursor-pointer hover:bg-accent/30 transition-colors',
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className={cn(
                    'flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium',
                    today && 'bg-primary text-primary-foreground',
                    !today && !inMonth && 'text-muted-foreground opacity-40',
                    !today && inMonth && 'text-foreground',
                  )}>
                    {format(day, 'd')}
                  </div>
                  {canCreate && (
                    <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map(item => (
                    <EventPill key={item.id} element={item} />
                  ))}
                  {items.length > 3 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          onClick={e => e.stopPropagation()}
                          className="w-full text-left text-xs text-muted-foreground px-1 rounded hover:bg-accent hover:text-foreground transition-colors"
                        >
                          +{items.length - 3} altri
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-64 p-2"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="text-xs font-semibold capitalize mb-1.5 px-1">
                          {format(day, 'EEEE d MMMM', { locale: it })}
                        </div>
                        <div className="space-y-0.5 max-h-72 overflow-auto">
                          {items.map(item => (
                            <EventPill key={item.id} element={item} />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {wsId && (
        <CreateEventDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          workspaceId={wsId}
          defaultDate={selectedDate}
        />
      )}
    </div>
  )
}
