import { useEffect, useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { elementsApi, tagsApi, workspacesApi } from '@/lib/api'
import { Tag, Member } from '@/types'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Kbd } from '@/components/ui/kbd'
import { toast } from '@/components/ui/toast'
import { TagChip, UserAvatar } from '@/components/shared'
import { cn, getErrorMessage } from '@/lib/utils'

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

// Giornata intera: mezzogiorno UTC, così la data non "scivola" con il fuso orario.
const allDayIso = (d: string) => (d ? `${d}T12:00:00Z` : undefined)
// Con orario: data e ora locali convertite in ISO.
const localIso = (d: string, t: string) => new Date(`${d}T${t || '00:00'}`).toISOString()

const today = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function CreateEventDialog({ open, onClose, workspaceId, defaultDate }: Props) {
  const queryClient = useQueryClient()
  const ids = useId()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('10:00')
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
      setStartDate(defaultDate ?? today())
      setStartTime('09:00')
      setEndDate('')
      setEndTime('10:00')
      setTagIds([])
      setAssigneeIds([])
    }
  }, [open, defaultDate])

  const toggle = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]

  const effectiveEndDate = endDate || startDate
  const rangeError =
    !allDay && startDate && effectiveEndDate && `${effectiveEndDate}T${endTime}` < `${startDate}T${startTime}`
      ? 'La fine deve essere successiva all\'inizio'
      : null
  const canSubmit = !!title.trim() && !!startDate && !rangeError && !loading

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    try {
      const el = await elementsApi.create(workspaceId, {
        type: 'EVENTO',
        title: title.trim(),
        body: textToTiptap(description),
        startDate: allDay ? allDayIso(startDate) : localIso(startDate, startTime),
        endDate: allDay ? undefined : localIso(effectiveEndDate, endTime),
        allDay,
        tagIds,
        assigneeIds,
      })
      queryClient.invalidateQueries({ queryKey: ['elements', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      toast('Evento creato', 'success')
      onClose()
      return el
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nella creazione'), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  // ⌘/Ctrl + Invio crea l'evento da qualunque campo (anche dalla descrizione).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const id = (s: string) => `${ids}-${s}`

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo evento</DialogTitle>
          <DialogDescription>Compare nel calendario del workspace e ai partecipanti.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} onKeyDown={onKeyDown} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={id('title')}>Titolo</Label>
            <Input
              id={id('title')}
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
              required
              placeholder="Es: Riunione di team"
            />
          </div>

          <fieldset className="space-y-3 rounded-lg border bg-surface-2 p-3">
            <legend className="sr-only">Quando</legend>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={id('allday')} className="cursor-pointer font-normal">Giornata intera</Label>
              <Switch id={id('allday')} checked={allDay} onCheckedChange={setAllDay} />
            </div>

            {allDay ? (
              <div className="space-y-1.5">
                <Label htmlFor={id('date')} className="text-xs text-muted-foreground">Data</Label>
                <Input id={id('date')} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <Label htmlFor={id('start')} className="text-xs text-muted-foreground">Inizio</Label>
                  <div className="grid grid-cols-[1fr_7rem] gap-2">
                    <Input id={id('start')} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                    <Input
                      type="time"
                      aria-label="Ora di inizio"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                      step={300}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={id('end')} className="text-xs text-muted-foreground">Fine</Label>
                  <div className="grid grid-cols-[1fr_7rem] gap-2">
                    <Input
                      id={id('end')}
                      type="date"
                      value={effectiveEndDate}
                      min={startDate || undefined}
                      onChange={e => setEndDate(e.target.value)}
                      aria-invalid={!!rangeError}
                    />
                    <Input
                      type="time"
                      aria-label="Ora di fine"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                      step={300}
                      aria-invalid={!!rangeError}
                    />
                  </div>
                  {rangeError && <p className="text-xs text-destructive" role="alert">{rangeError}</p>}
                </div>
              </div>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={id('desc')}>Descrizione</Label>
            <Textarea
              id={id('desc')}
              value={description}
              onChange={e => setDescription(e.target.value)}
              autoResize
              maxRows={8}
              rows={3}
              placeholder="Dettagli dell'evento…"
            />
          </div>

          {tags.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium" id={id('tags')}>Colore e tag</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={id('tags')}>
                {tags.map(tag => {
                  const active = tagIds.includes(tag.id)
                  return (
                    <button
                      type="button"
                      key={tag.id}
                      aria-pressed={active}
                      onClick={() => setTagIds(t => toggle(t, tag.id))}
                      className="focus-ring rounded-full"
                    >
                      <TagChip
                        tag={tag}
                        variant={active ? 'tinted' : 'dot'}
                        className={cn('cursor-pointer transition-colors', !active && 'text-muted-foreground hover:bg-accent hover:text-foreground')}
                      />
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">Il primo tag scelto dà il colore all'evento nel calendario.</p>
            </div>
          )}

          {members.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium" id={id('people')}>Partecipanti</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={id('people')}>
                {members.map(m => {
                  const active = assigneeIds.includes(m.userId)
                  return (
                    <button
                      type="button"
                      key={m.userId}
                      aria-pressed={active}
                      onClick={() => setAssigneeIds(a => toggle(a, m.userId))}
                      className={cn(
                        'focus-ring inline-flex h-7 items-center gap-1.5 rounded-full border pl-0.5 pr-2.5 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/10 text-foreground'
                          : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <UserAvatar name={m.displayName} avatar={m.avatar} size="xs" />
                      {m.displayName}
                      {active && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <DialogFooter className="pt-1 sm:items-center">
            <span className="mr-auto hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>Invio</Kbd>
              per creare
            </span>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={!canSubmit} loading={loading}>
              {loading ? 'Creazione…' : 'Crea evento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
