import {
  addDays, addMonths, addQuarters, addWeeks, addYears, differenceInCalendarDays, endOfMonth, endOfQuarter, endOfWeek,
  format, startOfDay, startOfMonth, startOfQuarter, startOfWeek, startOfYear,
} from 'date-fns'
import { it } from 'date-fns/locale'
import type { Element } from '@/types'

export type Zoom = 'week' | 'month' | 'quarter'

/** Pixel per giorno a ogni livello di zoom. */
export const PX_PER_DAY: Record<Zoom, number> = { week: 24, month: 5, quarter: 1.8 }
const MIN_WIDTH = 1400
const WEEK = { weekStartsOn: 1 } as const

export interface RoadmapRow {
  key: string
  el?: Element
  /** Riga di gruppo (es. "Senza epica") */
  groupLabel?: string
  depth: number
  childCount: number
  open: boolean
  /** Intervallo ricavato dai figli (per elementi senza date proprie) */
  span?: { start: Date; end: Date }
}

export interface TreeNode {
  el?: Element
  groupLabel?: string
  key: string
  children: TreeNode[]
  span?: { start: Date; end: Date }
}

/** Intervallo complessivo (date proprie + figli) di un nodo. */
function computeSpan(n: TreeNode): { start: Date; end: Date } | undefined {
  const ds: number[] = []
  for (const iso of [n.el?.startDate, n.el?.endDate]) {
    if (iso) {
      const t = new Date(iso).getTime()
      if (!isNaN(t)) ds.push(t)
    }
  }
  for (const c of n.children) {
    const cs = computeSpan(c)
    if (cs) ds.push(cs.start.getTime(), cs.end.getTime())
  }
  n.span = ds.length ? { start: new Date(Math.min(...ds)), end: new Date(Math.max(...ds)) } : undefined
  return n.span
}

const byDate = (a: Element, b: Element) => {
  const da = a.startDate ?? a.endDate
  const db = b.startDate ?? b.endDate
  if (da && db && da !== db) return da < db ? -1 : 1
  if (da && !db) return -1
  if (!da && db) return 1
  return (a.position ?? 0) - (b.position ?? 0)
}

/** Albero epica → storia → task (+ gruppo "Senza epica" per le storie orfane). */
export function buildTree(elements: Element[]): TreeNode[] {
  const byParent = new Map<string, Element[]>()
  const ids = new Set(elements.map(e => e.id))
  for (const e of elements) {
    if (!e.parentId) continue
    const l = byParent.get(e.parentId)
    if (l) l.push(e)
    else byParent.set(e.parentId, [e])
  }
  const node = (el: Element): TreeNode => {
    const kids = (byParent.get(el.id) ?? []).filter(c =>
      el.type === 'EPICA' ? c.type === 'STORIA' || c.type === 'TASK' : el.type === 'STORIA' ? c.type === 'TASK' : false
    )
    // Prima le storie, poi i task diretti; ciascun gruppo in ordine di data.
    kids.sort((a, b) => (a.type === b.type ? byDate(a, b) : a.type === 'STORIA' ? -1 : 1))
    return { el, key: el.id, children: kids.map(node) }
  }
  const epics = elements.filter(e => e.type === 'EPICA').sort(byDate)
  const roots = epics.map(node)
  const orphanStories = elements
    .filter(e => e.type === 'STORIA' && (!e.parentId || !ids.has(e.parentId)))
    .sort(byDate)
  if (orphanStories.length) {
    roots.push({ key: '__orphans', groupLabel: 'Storie senza epica', children: orphanStories.map(node) })
  }
  roots.forEach(computeSpan)
  return roots
}

export function flattenTree(roots: TreeNode[], isOpen: (n: TreeNode, depth: number) => boolean): RoadmapRow[] {
  const rows: RoadmapRow[] = []
  const walk = (n: TreeNode, depth: number) => {
    const open = n.children.length > 0 && isOpen(n, depth)
    rows.push({ key: n.key, el: n.el, groupLabel: n.groupLabel, depth, childCount: n.children.length, open, span: n.span })
    if (open) for (const c of n.children) walk(c, depth + 1)
  }
  roots.forEach(r => walk(r, 0))
  return rows
}

export function collectDates(roots: TreeNode[]): Date[] {
  const out: Date[] = []
  const walk = (n: TreeNode) => {
    if (n.el?.startDate) out.push(new Date(n.el.startDate))
    if (n.el?.endDate) out.push(new Date(n.el.endDate))
    n.children.forEach(walk)
  }
  roots.forEach(walk)
  return out.filter(d => !isNaN(d.getTime()))
}

export interface Scale {
  start: Date
  end: Date
  days: number
  ppd: number
  width: number
  x: (d: Date) => number
}

export function buildScale(dates: Date[], zoom: Zoom, today = new Date()): Scale {
  const all = [...dates, today]
  let min = new Date(Math.min(...all.map(d => d.getTime())))
  let max = new Date(Math.max(...all.map(d => d.getTime())))
  if (zoom === 'week') {
    min = startOfWeek(addWeeks(min, -1), WEEK)
    max = endOfWeek(addWeeks(max, 1), WEEK)
  } else if (zoom === 'month') {
    min = startOfMonth(addDays(min, -14))
    max = endOfMonth(addDays(max, 14))
  } else {
    min = startOfQuarter(min)
    max = endOfQuarter(addDays(max, 30))
  }
  const ppd = PX_PER_DAY[zoom]
  // Riempi almeno la larghezza minima, così la griglia non resta "corta".
  const minDays = Math.ceil(MIN_WIDTH / ppd)
  if (differenceInCalendarDays(max, min) + 1 < minDays) max = addDays(min, minDays - 1)
  const start = startOfDay(min)
  const end = startOfDay(max)
  const days = differenceInCalendarDays(end, start) + 1
  return { start, end, days, ppd, width: days * ppd, x: d => differenceInCalendarDays(d, start) * ppd }
}

export interface Segment {
  key: string
  label: string
  left: number
  width: number
}

function segments(scale: Scale, startOf: (d: Date) => Date, add: (d: Date, n: number) => Date, label: (d: Date) => string): Segment[] {
  const out: Segment[] = []
  let cur = startOf(scale.start)
  while (cur <= scale.end) {
    const next = add(cur, 1)
    const from = cur < scale.start ? scale.start : cur
    const to = next > addDays(scale.end, 1) ? addDays(scale.end, 1) : next
    out.push({
      key: cur.toISOString(),
      label: label(cur),
      left: scale.x(from),
      width: differenceInCalendarDays(to, from) * scale.ppd,
    })
    cur = next
  }
  return out
}

/** Intestazione su due righe: [superiore, inferiore] per lo zoom scelto. */
export function headerSegments(scale: Scale, zoom: Zoom): [Segment[], Segment[]] {
  const months = () => segments(scale, startOfMonth, addMonths, d => format(d, 'MMMM yyyy', { locale: it }))
  const years = () => segments(scale, startOfYear, addYears, d => format(d, 'yyyy'))
  if (zoom === 'week') {
    return [months(), segments(scale, d => startOfWeek(d, WEEK), addWeeks, d => format(d, 'd MMM', { locale: it }))]
  }
  if (zoom === 'month') {
    return [years(), segments(scale, startOfMonth, addMonths, d => format(d, 'MMM', { locale: it }))]
  }
  return [years(), segments(scale, startOfQuarter, addQuarters, d => `T${Math.floor(d.getMonth() / 3) + 1}`)]
}
