import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import {
  addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isSameWeek,
  startOfMonth, startOfWeek,
} from 'date-fns'
import { it } from 'date-fns/locale'
import { elementsApi } from '@/lib/api'
import type { Element } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader, QueryState } from '@/components/shared'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { CreateEventDialog } from '@/components/CreateEventDialog'
import { MonthView } from '@/components/calendar/MonthView'
import { WeekView } from '@/components/calendar/WeekView'
import { AgendaView } from '@/components/calendar/AgendaView'
import { CalendarItemRow } from '@/components/calendar/CalendarChip'
import { useElementDelete } from '@/lib/useElementDelete'
import { useMediaQuery } from '@/components/calendar/use-media-query'
import {
  bucketByDay, dayKey, emptyItems, type CalendarFilter, type CalendarView,
} from '@/components/calendar/calendar-utils'

const WEEK = { weekStartsOn: 1 } as const
const VIEW_KEY = 'wt.calendar.view'
const FILTER_KEY = 'wt.calendar.filter'

function readPref<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : null
  } catch {
    return null
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage non disponibile: la preferenza vale solo per la sessione */
  }
}

const VIEWS = ['month', 'week', 'agenda'] as const
const FILTERS = ['all', 'events', 'tasks'] as const

export default function CalendarPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const workspace = useWorkspaceStore(s => s.current)
  const canCreate = workspace?.myRole !== 'GUEST'
  const isMobile = useMediaQuery('(max-width: 639px)')
  // Sotto md la barra superiore mostra già il titolo della sezione.
  const showTitle = useMediaQuery('(min-width: 768px)')

  const [cursor, setCursor] = useState(() => new Date())
  const [focusDate, setFocusDate] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState(() => dayKey(new Date()))
  // Su mobile la vista predefinita è l'agenda; su desktop si ricorda l'ultima scelta.
  const [view, setViewState] = useState<CalendarView>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches
      ? 'agenda'
      : readPref(VIEW_KEY, VIEWS) ?? 'month'
  )
  const [filter, setFilterState] = useState<CalendarFilter>(() => readPref(FILTER_KEY, FILTERS) ?? 'all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | undefined>()

  const setView = (v: CalendarView) => {
    setViewState(v)
    if (!isMobile) writePref(VIEW_KEY, v)
  }
  const setFilter = (f: CalendarFilter) => {
    setFilterState(f)
    writePref(FILTER_KEY, f)
  }

  const query = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: !!wsId,
  })
  const elements = query.data

  const { canDelete, remove } = useElementDelete(wsId)
  const onDelete = useCallback((el: Element) => void remove(el), [remove])

  // Giorni visibili: ricalcolati solo quando cambia il mese/settimana, non a ogni render.
  const monthKey = format(cursor, 'yyyy-MM')
  const weekKey = format(startOfWeek(cursor, WEEK), 'yyyy-MM-dd')
  const days = useMemo(() => {
    if (view === 'week') return eachDayOfInterval({ start: startOfWeek(cursor, WEEK), end: endOfWeek(cursor, WEEK) })
    const ms = startOfMonth(cursor)
    const me = endOfMonth(cursor)
    if (view === 'agenda') return eachDayOfInterval({ start: ms, end: me })
    return eachDayOfInterval({ start: startOfWeek(ms, WEEK), end: endOfWeek(me, WEEK) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, view === 'week' ? weekKey : monthKey])

  // Un solo passaggio sugli elementi per l'intervallo visibile → Map giorno → elementi.
  const buckets = useMemo(
    () => bucketByDay(elements ?? [], days[0], days[days.length - 1], filter),
    [elements, days, filter]
  )

  const todayKey = dayKey(new Date())

  const openCreate = useCallback(
    (day?: Date) => {
      if (!canCreate) return
      setSelectedDate(format(day ?? new Date(), 'yyyy-MM-dd'))
      setDialogOpen(true)
    },
    [canCreate]
  )

  // Click/Invio su un giorno del mese: su mobile seleziona il giorno, su desktop crea un evento.
  const onActivate = useCallback(
    (d: Date) => {
      setFocusDate(d)
      if (isMobile) setSelectedKey(dayKey(d))
      else openCreate(d)
    },
    [isMobile, openCreate]
  )

  const onFocusDate = useCallback((d: Date) => {
    setFocusDate(d)
    setCursor(c => (isSameMonth(c, d) ? c : d))
  }, [])

  const step = (dir: 1 | -1) => {
    const next = view === 'week' ? addWeeks(cursor, dir) : addMonths(cursor, dir)
    setCursor(next)
    setFocusDate(next)
    setSelectedKey(dayKey(isSameMonth(next, new Date()) ? new Date() : startOfMonth(next)))
  }
  const goToday = () => {
    const now = new Date()
    setCursor(now)
    setFocusDate(now)
    setSelectedKey(dayKey(now))
  }

  const isCurrent = view === 'week' ? isSameWeek(cursor, new Date(), WEEK) : isSameMonth(cursor, new Date())

  const title =
    view === 'week'
      ? (() => {
          const s = days[0]
          const e = days[6]
          return s.getMonth() === e.getMonth()
            ? `${format(s, 'd')} – ${format(e, 'd MMMM yyyy', { locale: it })}`
            : `${format(s, 'd MMM', { locale: it })} – ${format(e, 'd MMM yyyy', { locale: it })}`
        })()
      : format(cursor, 'MMMM yyyy', { locale: it })

  // Il giorno "tabbabile" della griglia deve essere visibile.
  const gridFocus = isSameMonth(focusDate, cursor) ? focusDate : startOfMonth(cursor)
  const selectedItems = buckets.get(selectedKey) ?? emptyItems()
  const selectedDay = new Date(`${selectedKey}T12:00:00`)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
        <PageHeader
          title={showTitle ? 'Calendario' : <span className="sr-only">Calendario</span>}
          description={showTitle ? workspace?.name : undefined}
          icon={showTitle ? CalendarDays : undefined}
          className="pb-3 sm:pb-4"
          actions={
            canCreate && (
              <Button size="sm" onClick={() => openCreate(view === 'month' && isMobile ? selectedDay : undefined)}>
                <Plus className="h-4 w-4" /> Nuovo evento
              </Button>
            )
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-1">
              <Button variant="outline" size="sm" onClick={goToday} disabled={isCurrent && isSameMonth(focusDate, new Date())}>
                Oggi
              </Button>
              <IconButton
                label={view === 'week' ? 'Settimana precedente' : 'Mese precedente'}
                icon={<ChevronLeft />}
                onClick={() => step(-1)}
              />
              <IconButton
                label={view === 'week' ? 'Settimana successiva' : 'Mese successivo'}
                icon={<ChevronRight />}
                onClick={() => step(1)}
              />
              <h2 className="ml-1 truncate text-heading capitalize" aria-live="polite">
                {title}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={filter} onValueChange={v => setFilter(v as CalendarFilter)}>
                <TabsList className="h-8" aria-label="Filtra elementi">
                  <TabsTrigger value="all" className="px-2.5 text-xs">Tutti</TabsTrigger>
                  <TabsTrigger value="events" className="px-2.5 text-xs">Eventi</TabsTrigger>
                  <TabsTrigger value="tasks" className="px-2.5 text-xs">Scadenze</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs value={view} onValueChange={v => setView(v as CalendarView)}>
                <TabsList className="h-8" aria-label="Vista">
                  <TabsTrigger value="month" className="px-2.5 text-xs">Mese</TabsTrigger>
                  <TabsTrigger value="week" className="px-2.5 text-xs">Settimana</TabsTrigger>
                  <TabsTrigger value="agenda" className="px-2.5 text-xs">Agenda</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </PageHeader>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        <QueryState
          query={query}
          isEmpty={false}
          loading={<Skeleton className="h-[28rem] w-full rounded-lg" />}
          errorTitle="Impossibile caricare il calendario"
        >
          {view === 'month' && (
            <>
              <MonthView
                days={days}
                month={cursor}
                buckets={buckets}
                todayKey={todayKey}
                focusDate={gridFocus}
                selectedKey={selectedKey}
                canCreate={canCreate}
                compact={isMobile}
                onActivate={onActivate}
                onCreate={openCreate}
                onFocusDate={onFocusDate}
                canDelete={canDelete}
                onDelete={onDelete}
              />
              {isMobile && (
                <section aria-live="polite" className="mt-3 rounded-lg border bg-card p-1 shadow-xs">
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <h3 className="text-sm font-semibold capitalize">
                      {selectedKey === todayKey ? 'Oggi · ' : ''}
                      {format(selectedDay, 'EEEE d MMMM', { locale: it })}
                    </h3>
                    {canCreate && (
                      <IconButton label="Nuovo evento in questo giorno" icon={<Plus />} size="xs" onClick={() => openCreate(selectedDay)} />
                    )}
                  </div>
                  {selectedItems.length === 0 ? (
                    <p className="px-2 pb-2 text-sm text-muted-foreground">Niente in programma.</p>
                  ) : (
                    selectedItems.map(item => (
                      <CalendarItemRow key={item.el.id} item={item} canDelete={canDelete} onDelete={onDelete} />
                    ))
                  )}
                </section>
              )}
            </>
          )}
          {view === 'week' && (
            <WeekView
              days={days}
              buckets={buckets}
              todayKey={todayKey}
              canCreate={canCreate}
              compact={isMobile}
              onCreate={openCreate}
              canDelete={canDelete}
              onDelete={onDelete}
            />
          )}
          {view === 'agenda' && (
            <AgendaView
              days={days}
              buckets={buckets}
              todayKey={todayKey}
              canCreate={canCreate}
              onCreate={openCreate}
              canDelete={canDelete}
              onDelete={onDelete}
            />
          )}
        </QueryState>
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
