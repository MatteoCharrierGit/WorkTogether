import { addDays, format, startOfDay } from 'date-fns'
import type { Element } from '@/types'

export type CalendarFilter = 'all' | 'events' | 'tasks'
export type CalendarView = 'month' | 'week' | 'agenda'

export interface CalendarItem {
  el: Element
  kind: 'event' | 'task'
  /** Orario di inizio "HH:mm" se l'evento non è a giornata intera e inizia in quel giorno */
  time?: string
  /** true se l'evento copre più giorni */
  multiDay: boolean
  /** true se il giorno è il primo dell'evento (per mostrare l'orario) */
  isStart: boolean
  /** Ordinamento nel giorno */
  sort: number
}

export const dayKey = (d: Date) => format(d, 'yyyy-MM-dd')

const EMPTY: CalendarItem[] = []
export const emptyItems = () => EMPTY

/**
 * Raggruppa gli elementi per giorno UNA volta (O(elementi × giorni coperti)),
 * limitandosi all'intervallo visibile. Le celle leggono poi la mappa in O(1).
 */
export function bucketByDay(
  elements: Element[],
  rangeStart: Date,
  rangeEnd: Date,
  filter: CalendarFilter
): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>()
  const rs = startOfDay(rangeStart).getTime()
  const re = startOfDay(rangeEnd).getTime()
  const push = (key: string, item: CalendarItem) => {
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }

  for (const el of elements) {
    if (el.type === 'EVENTO' && filter !== 'tasks') {
      if (!el.startDate) continue
      const start = new Date(el.startDate)
      const end = el.endDate ? new Date(el.endDate) : start
      if (isNaN(start.getTime())) continue
      const s0 = startOfDay(start)
      const e0 = startOfDay(end < start ? start : end)
      if (e0.getTime() < rs || s0.getTime() > re) continue
      const multiDay = e0.getTime() > s0.getTime()
      const timed = !el.allDay
      let cur = s0.getTime() < rs ? new Date(rs) : s0
      const last = e0.getTime() > re ? new Date(re) : e0
      while (cur.getTime() <= last.getTime()) {
        const isStart = cur.getTime() === s0.getTime()
        push(dayKey(cur), {
          el,
          kind: 'event',
          multiDay,
          isStart,
          time: timed && isStart ? format(start, 'HH:mm') : undefined,
          // Prima eventi su più giorni / giornata intera, poi per orario
          sort: multiDay ? 0 : timed ? 1 + start.getHours() * 60 + start.getMinutes() : 0.5,
        })
        cur = addDays(cur, 1)
      }
    } else if (el.type === 'TASK' && filter !== 'events') {
      if (!el.endDate) continue
      const due = startOfDay(new Date(el.endDate))
      const t = due.getTime()
      if (isNaN(t) || t < rs || t > re) continue
      push(dayKey(due), { el, kind: 'task', multiDay: false, isStart: true, sort: 5000 })
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => a.sort - b.sort || a.el.title.localeCompare(b.el.title, 'it'))
  }
  return map
}
