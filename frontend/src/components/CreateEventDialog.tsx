import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { elementsApi, tagsApi, workspacesApi } from '@/lib/api'
import { Tag, Member } from '@/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'
import { UserAvatar } from '@/components/UserAvatar'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
  defaultDate?: string // 'YYYY-MM-DD'
}

// Converte testo semplice (multi-riga) in un documento Tiptap valido per il body.
function textToTiptap(text: string): string | undefined {
  const t = text.trim()
  if (!t) return undefined
  const content = t.split('\n').map(line =>
    line.trim()
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }
  )
  return JSON.stringify({ type: 'doc', content })
}

const toIso = (d: string) => (d ? `${d}T12:00:00Z` : undefined)

export function CreateEventDialog({ open, onClose, workspaceId, defaultDate }: Props) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ['tags', workspaceId],
    queryFn: () => tagsApi.list(workspaceId),
    enabled: open,
  })
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', workspaceId],
    queryFn: () => workspacesApi.getMembers(workspaceId),
    enabled: open,
  })

  // Reset all'apertura, con eventuale data preselezionata (click sul giorno).
  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setAllDay(true)
      setStartDate(defaultDate ?? '')
      setEndDate('')
      setTagIds([])
      setAssigneeIds([])
    }
  }, [open, defaultDate])

  const toggle = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startDate) return
    setLoading(true)
    try {
      const el = await elementsApi.create(workspaceId, {
        type: 'EVENTO',
        title: title.trim(),
        body: textToTiptap(description),
        startDate: toIso(startDate),
        endDate: allDay ? undefined : toIso(endDate || startDate),
        allDay,
        tagIds,
        assigneeIds,
      })
      queryClient.invalidateQueries({ queryKey: ['elements', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      toast('Evento creato')
      onClose()
      return el
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nella creazione', 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nuovo evento</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Titolo</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} autoFocus required placeholder="Es: Riunione di team" />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="h-4 w-4 rounded border-input" />
            Giornata intera
          </label>

          <div className={cn('grid gap-3', allDay ? 'grid-cols-1' : 'grid-cols-2')}>
            <div className="space-y-1.5">
              <Label>{allDay ? 'Data' : 'Inizio'}</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required
                className="text-sm" />
            </div>
            {!allDay && (
              <div className="space-y-1.5">
                <Label>Fine</Label>
                <Input type="date" value={endDate} min={startDate || undefined}
                  onChange={e => setEndDate(e.target.value)} className="text-sm" />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Descrizione</Label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Dettagli dell'evento..."
            />
          </div>

          {tags.length > 0 && (
            <div className="space-y-1.5">
              <Label>Tag</Label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => {
                  const active = tagIds.includes(tag.id)
                  return (
                    <button
                      type="button"
                      key={tag.id}
                      onClick={() => setTagIds(t => toggle(t, tag.id))}
                      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-opacity', !active && 'opacity-40')}
                      style={{ backgroundColor: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
                    >
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {members.length > 0 && (
            <div className="space-y-1.5">
              <Label>Partecipanti</Label>
              <div className="flex flex-wrap gap-1.5">
                {members.map(m => {
                  const active = assigneeIds.includes(m.userId)
                  return (
                    <button
                      type="button"
                      key={m.userId}
                      onClick={() => setAssigneeIds(a => toggle(a, m.userId))}
                      className={cn('flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
                        active ? 'bg-accent border-primary/40' : 'opacity-60 hover:opacity-100')}
                    >
                      <UserAvatar name={m.displayName} avatar={m.avatar} className="h-4 w-4" fallbackClassName="text-[8px]" />
                      {m.displayName}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={loading || !title.trim() || !startDate}>
              {loading ? 'Creazione...' : 'Crea evento'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
