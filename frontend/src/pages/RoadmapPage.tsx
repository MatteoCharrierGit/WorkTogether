import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { elementsApi } from '@/lib/api'
import { Element } from '@/types'
import { cn, formatDate, TYPE_ICONS } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { CreateElementDialog } from '@/components/CreateElementDialog'
import { useWorkspaceStore } from '@/store/workspaceStore'

function GanttBar({ element, minDate, maxDate, totalDays }: {
  element: Element
  minDate: Date
  maxDate: Date
  totalDays: number
}) {
  if (!element.startDate || !element.endDate) return null
  const start = new Date(element.startDate)
  const end = new Date(element.endDate)
  const left = Math.max(0, (start.getTime() - minDate.getTime()) / (totalDays * 86400000)) * 100
  const width = Math.max(1, (end.getTime() - start.getTime()) / (totalDays * 86400000)) * 100

  const isEpic = element.type === 'EPICA'

  return (
    <div
      className={cn(
        'absolute top-1/2 -translate-y-1/2 h-5 rounded-full flex items-center px-2 overflow-hidden',
        isEpic ? 'bg-primary/80 text-primary-foreground' : 'bg-blue-400/70 text-white'
      )}
      style={{ left: `${Math.min(left, 95)}%`, width: `${Math.min(width, 100 - left)}%`, minWidth: '4px' }}
      title={`${element.title}\n${formatDate(element.startDate)} → ${formatDate(element.endDate)}`}
    >
      <span className="text-[10px] font-medium truncate">{element.title}</span>
    </div>
  )
}

function EpicRow({ epic, stories, allElements, minDate, maxDate, totalDays }: {
  epic: Element
  stories: Element[]
  allElements: Element[]
  minDate: Date
  maxDate: Date
  totalDays: number
}) {
  const [open, setOpen] = useState(true)

  return (
    <>
      {/* Epic row */}
      <div className="flex items-center border-b hover:bg-muted/30 transition-colors group">
        <div className="w-64 shrink-0 flex items-center gap-1.5 px-3 py-2.5 border-r">
          <button onClick={() => setOpen(o => !o)} className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <span className="text-xs">{TYPE_ICONS['EPICA']}</span>
          <a
            href={`/workspace/${epic.workspaceId}/element/${epic.id}`}
            className="text-sm font-semibold truncate hover:text-primary transition-colors"
          >
            {epic.title}
          </a>
        </div>
        <div className="w-28 shrink-0 px-3 py-2.5 border-r">
          <div className="flex items-center gap-2">
            <Progress value={epic.progress ?? 0} className="h-1.5 flex-1" />
            <span className="text-xs text-muted-foreground w-8 text-right">{epic.progress ?? 0}%</span>
          </div>
        </div>
        <div className="flex-1 relative h-10">
          <GanttBar element={epic} minDate={minDate} maxDate={maxDate} totalDays={totalDays} />
        </div>
      </div>

      {/* Story rows */}
      {open && stories.map(story => (
        <div key={story.id} className="flex items-center border-b bg-muted/10 hover:bg-muted/30 transition-colors">
          <div className="w-64 shrink-0 flex items-center gap-1.5 px-3 py-2 border-r pl-9">
            <span className="text-xs">{TYPE_ICONS['STORIA']}</span>
            <a
              href={`/workspace/${story.workspaceId}/element/${story.id}`}
              className="text-sm truncate hover:text-primary transition-colors text-muted-foreground"
            >
              {story.title}
            </a>
          </div>
          <div className="w-28 shrink-0 border-r" />
          <div className="flex-1 relative h-9">
            <GanttBar element={story} minDate={minDate} maxDate={maxDate} totalDays={totalDays} />
          </div>
        </div>
      ))}
    </>
  )
}

export default function RoadmapPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const workspace = useWorkspaceStore(s => s.current)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: elements = [] } = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: !!wsId,
  })

  const epics = elements.filter(e => e.type === 'EPICA')
  const stories = elements.filter(e => e.type === 'STORIA')

  // Compute timeline range
  const dated = elements.filter(e => e.startDate && e.endDate)
  const minDate = dated.length > 0
    ? new Date(Math.min(...dated.map(e => new Date(e.startDate!).getTime())))
    : new Date()
  const maxDate = dated.length > 0
    ? new Date(Math.max(...dated.map(e => new Date(e.endDate!).getTime())))
    : new Date(Date.now() + 90 * 86400000)

  const totalDays = Math.max(30, (maxDate.getTime() - minDate.getTime()) / 86400000)

  // Build month headers
  const months: { label: string; left: number; width: number }[] = []
  let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1)
  while (cursor <= maxDate) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const l = Math.max(0, (cursor.getTime() - minDate.getTime()) / (totalDays * 86400000)) * 100
    const segEnd = Math.min(next.getTime(), maxDate.getTime())
    const segStart = Math.max(cursor.getTime(), minDate.getTime())
    const w = ((segEnd - segStart) / (totalDays * 86400000)) * 100
    months.push({
      label: cursor.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
      left: l,
      width: w,
    })
    cursor = next
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Roadmap</h1>
          <p className="text-xs text-muted-foreground">{workspace?.name}</p>
        </div>
        {workspace?.myRole === 'ADMIN' && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nuova epica
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {/* Table header */}
        <div className="flex items-center border-b bg-muted/20 sticky top-0 z-10">
          <div className="w-64 shrink-0 px-3 py-2 border-r text-xs font-medium text-muted-foreground">Elemento</div>
          <div className="w-28 shrink-0 px-3 py-2 border-r text-xs font-medium text-muted-foreground">Progresso</div>
          <div className="flex-1 relative h-8 overflow-hidden">
            {months.map((m, i) => (
              <div
                key={i}
                className="absolute top-0 h-full flex items-center px-2 border-r last:border-r-0"
                style={{ left: `${m.left}%`, width: `${m.width}%` }}
              >
                <span className="text-xs text-muted-foreground whitespace-nowrap overflow-hidden">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        {epics.map(epic => (
          <EpicRow
            key={epic.id}
            epic={epic}
            stories={stories.filter(s => s.parentId === epic.id)}
            allElements={elements}
            minDate={minDate}
            maxDate={maxDate}
            totalDays={totalDays}
          />
        ))}

        {epics.length === 0 && (
          <div className="flex items-center justify-center h-64 text-center">
            <div>
              <p className="text-muted-foreground text-sm">Nessuna epica trovata.</p>
              {workspace?.myRole === 'ADMIN' && (
                <Button variant="link" size="sm" onClick={() => setCreateOpen(true)}>
                  Crea la prima epica →
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <CreateElementDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={wsId!}
        defaultType="EPICA"
      />
    </div>
  )
}
