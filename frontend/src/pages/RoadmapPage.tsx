import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarRange, ChevronsDownUp, ChevronsUpDown, Map as MapIcon, Plus, Rocket } from 'lucide-react'
import { elementsApi } from '@/lib/api'
import type { Element } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState, PageHeader, QueryState } from '@/components/shared'
import { CreateElementDialog } from '@/components/CreateElementDialog'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDeleteElement } from '@/components/calendar/use-delete-element'
import { useMediaQuery } from '@/components/calendar/use-media-query'
import {
  buildScale, buildTree, collectDates, flattenTree, headerSegments, type TreeNode, type Zoom,
} from '@/components/roadmap/roadmap-utils'
import { TimelineGrid, TimelineHeader, TimelineRow } from '@/components/roadmap/RoadmapTimeline'

const ZOOM_KEY = 'wt.roadmap.zoom'
function readZoom(): Zoom {
  try {
    const v = localStorage.getItem(ZOOM_KEY)
    return v === 'week' || v === 'month' || v === 'quarter' ? v : 'month'
  } catch {
    return 'month'
  }
}

/** Di default sono aperte solo le epiche (si vedono le storie); storie e gruppi chiusi. */
const defaultOpen = (n: TreeNode) => n.el?.type === 'EPICA' || (!n.el && !!n.groupLabel)

export default function RoadmapPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const workspace = useWorkspaceStore(s => s.current)
  const isAdmin = workspace?.myRole === 'ADMIN'
  // Sotto md la barra superiore mostra già il titolo della sezione.
  const showTitle = useMediaQuery('(min-width: 768px)')
  const [createOpen, setCreateOpen] = useState(false)
  const [zoom, setZoomState] = useState<Zoom>(readZoom)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const cornerRef = useRef<HTMLDivElement>(null)

  const setZoom = (z: Zoom) => {
    setZoomState(z)
    try {
      localStorage.setItem(ZOOM_KEY, z)
    } catch {
      /* preferenza solo per la sessione */
    }
  }

  const query = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: !!wsId,
  })
  const elements = query.data

  // Il tempo reale (ELEMENT_*) è gestito globalmente da useRealtimeSync.

  const { canDelete, remove } = useDeleteElement(wsId)
  const onDelete = useCallback((el: Element) => void remove(el), [remove])
  const onToggle = useCallback(
    (key: string) =>
      setOverrides(o => {
        // Il valore corrente dipende dal default del nodo: lo ricaviamo dalle righe visibili.
        const cur = key in o ? o[key] : undefined
        return { ...o, [key]: cur === undefined ? !openByDefault.current.has(key) : !cur }
      }),
    []
  )

  const tree = useMemo(() => buildTree(elements ?? []), [elements])
  const openByDefault = useRef(new Set<string>())
  openByDefault.current = useMemo(() => {
    const s = new Set<string>()
    const walk = (n: TreeNode) => {
      if (defaultOpen(n)) s.add(n.key)
      n.children.forEach(walk)
    }
    tree.forEach(walk)
    return s
  }, [tree])

  const rows = useMemo(
    () => flattenTree(tree, n => (n.key in overrides ? overrides[n.key] : defaultOpen(n))),
    [tree, overrides]
  )
  const dates = useMemo(() => collectDates(tree), [tree])
  const scale = useMemo(() => buildScale(dates, zoom), [dates, zoom])
  const [top, bottom] = useMemo(() => headerSegments(scale, zoom), [scale, zoom])
  const now = new Date()
  const todayX = now >= scale.start ? scale.x(now) + scale.ppd / 2 : null

  const scrollToToday = useCallback(
    (smooth = false) => {
      const el = scrollRef.current
      if (!el || todayX == null) return
      const leftW = cornerRef.current?.offsetWidth ?? 0
      const visible = el.clientWidth - leftW
      el.scrollTo({ left: Math.max(0, todayX - visible / 3), behavior: smooth ? 'smooth' : 'auto' })
    },
    [todayX]
  )

  // Al primo render e a ogni cambio di zoom porta "oggi" in vista.
  const hasData = !!elements
  useLayoutEffect(() => {
    if (hasData) scrollToToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, hasData])

  const anyExpandable = rows.some(r => r.childCount > 0)
  const allOpen = rows.filter(r => r.childCount > 0).every(r => r.open)
  const setAll = (open: boolean) => {
    const next: Record<string, boolean> = {}
    const walk = (n: TreeNode) => {
      if (n.children.length) next[n.key] = open
      n.children.forEach(walk)
    }
    tree.forEach(walk)
    setOverrides(next)
  }

  const epicCount = tree.filter(n => n.el?.type === 'EPICA').length

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
        <PageHeader
          title={showTitle ? 'Roadmap' : <span className="sr-only">Roadmap</span>}
          description={showTitle ? workspace?.name : undefined}
          icon={showTitle ? MapIcon : undefined}
          className="pb-3 sm:pb-4"
          actions={
            isAdmin && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Nuova epica
              </Button>
            )
          }
        >
          {tree.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => scrollToToday(true)} disabled={todayX == null}>
                  Oggi
                </Button>
                {anyExpandable && (
                  <IconButton
                    label={allOpen ? 'Comprimi tutto' : 'Espandi tutto'}
                    icon={allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
                    onClick={() => setAll(!allOpen)}
                  />
                )}
                <div className="ml-2 hidden items-center gap-3 text-xs text-muted-foreground md:flex" aria-label="Legenda">
                  <Legend className="border-primary/45 bg-primary/10" label="Epica" />
                  <Legend className="border-border-strong bg-muted" label="Da fare" />
                  <Legend className="border-info/45 bg-info-subtle" label="In corso" />
                  <Legend className="border-success/45 bg-success-subtle" label="Completato" />
                </div>
              </div>
              <Tabs value={zoom} onValueChange={v => setZoom(v as Zoom)}>
                <TabsList className="h-8" aria-label="Scala temporale">
                  <TabsTrigger value="week" className="px-2.5 text-xs">Settimane</TabsTrigger>
                  <TabsTrigger value="month" className="px-2.5 text-xs">Mesi</TabsTrigger>
                  <TabsTrigger value="quarter" className="px-2.5 text-xs">Trimestri</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}
        </PageHeader>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6 sm:pb-6">
        <QueryState
          query={query}
          isEmpty={tree.length === 0}
          loading={<Skeleton className="h-80 w-full rounded-lg" />}
          errorTitle="Impossibile caricare la roadmap"
          empty={{
            icon: Rocket,
            title: 'Nessuna epica',
            description: 'Le epiche raggruppano storie e task: crea la prima per pianificare il lavoro nel tempo.',
            bordered: true,
            action: isAdmin && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Crea la prima epica
              </Button>
            ),
          }}
        >
          {dates.length === 0 && (
            <EmptyState
              size="sm"
              bordered
              icon={CalendarRange}
              title="Nessun elemento pianificato"
              description="Imposta data di inizio e fine su epiche, storie o task per vederli sulla timeline."
              className="mb-3"
            />
          )}
          <div
            ref={scrollRef}
            role="grid"
            aria-label={`Roadmap: ${epicCount} epiche`}
            className="relative min-h-0 overflow-auto overscroll-x-contain rounded-lg border bg-background shadow-xs [--left-w:9.5rem] sm:[--left-w:16rem] lg:[--left-w:19rem]"
          >
            <div className="relative" style={{ width: `calc(var(--left-w) + ${scale.width}px)` }}>
              <TimelineHeader
                ref={cornerRef}
                top={top}
                bottom={bottom}
                scale={scale}
                todayX={todayX}
                label="Elemento"
              />
              <div className="relative">
                <TimelineGrid bottom={bottom} todayX={todayX} />
                {rows.map(row => (
                  <TimelineRow
                    key={row.key}
                    row={row}
                    scale={scale}
                    canDelete={canDelete}
                    onDelete={onDelete}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          </div>
        </QueryState>
      </div>

      {wsId && (
        <CreateElementDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          workspaceId={wsId}
          defaultType="EPICA"
        />
      )}
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-4 rounded-sm border ${className}`} aria-hidden="true" />
      {label}
    </span>
  )
}
