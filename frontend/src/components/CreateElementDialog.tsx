import { useEffect, useId, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { elementsApi } from '@/lib/api'
import { Element, ElementPriority, ElementType } from '@/types'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Kbd } from '@/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { PriorityIndicator, PRIORITY_ORDER, TypeIcon } from '@/components/shared'
import { cn, getErrorMessage, TYPE_LABELS } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
  defaultType?: ElementType
  defaultParentId?: string
}

const TYPES: ElementType[] = ['EPICA', 'STORIA', 'TASK', 'EVENTO']
const NO_PARENT = '__none__'

const TYPE_HINT: Record<ElementType, string> = {
  EPICA: 'Un grande obiettivo che raggruppa più storie.',
  STORIA: "Una funzionalità o un risultato: appartiene a un'epica e contiene task.",
  TASK: 'Un lavoro concreto. Nel Kanban compare sotto la sua storia.',
  EVENTO: 'Un appuntamento visibile nel calendario.',
}

export function CreateElementDialog({ open, onClose, workspaceId, defaultType = 'TASK', defaultParentId }: Props) {
  const queryClient = useQueryClient()
  const uid = useId()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ElementType>(defaultType)
  const [parentId, setParentId] = useState(defaultParentId ?? '')
  const [priority, setPriority] = useState<ElementPriority>('NONE')
  const [loading, setLoading] = useState(false)

  // Ogni apertura riparte dai default (lo stesso dialog può essere riusato per storie diverse).
  useEffect(() => {
    if (!open) return
    setTitle('')
    setType(defaultType)
    setParentId(defaultParentId ?? '')
    setPriority('NONE')
  }, [open, defaultType, defaultParentId])

  const elementsQuery = useQuery<Element[]>({
    queryKey: ['elements', workspaceId],
    queryFn: () => elementsApi.list(workspaceId),
    enabled: open && !!workspaceId,
  })
  const elements = elementsQuery.data

  // La priorità ha senso per task e storie.
  const hasPriority = type === 'TASK' || type === 'STORIA'
  const parentType: ElementType | null = type === 'TASK' ? 'STORIA' : type === 'STORIA' ? 'EPICA' : null
  // Elementi aperti prima, conclusi in fondo.
  const parentOptions = useMemo(() => {
    if (!parentType || !elements) return []
    return elements
      .filter(e => e.type === parentType && e.status !== 'ARCHIVIATO')
      .sort((a, b) => (a.status === 'COMPLETATO' ? 1 : 0) - (b.status === 'COMPLETATO' ? 1 : 0))
  }, [elements, parentType])

  const changeType = (t: ElementType) => {
    setType(t)
    // Il genitore scelto non è più valido se cambia il livello.
    if (t !== type) setParentId(t === defaultType ? (defaultParentId ?? '') : '')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || loading) return
    setLoading(true)
    try {
      await elementsApi.create(workspaceId, {
        title: title.trim(),
        type,
        parentId: parentType && parentId ? parentId : undefined,
        priority: hasPriority && priority !== 'NONE' ? priority : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['elements', workspaceId] })
      toast(`${TYPE_LABELS[type]} creat${type === 'TASK' || type === 'EVENTO' ? 'o' : 'a'}`, 'success')
      setTitle('')
      onClose()
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nella creazione'), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  const titleId = `${uid}-title`
  const parentFieldId = `${uid}-parent`
  const parentLabel = parentType === 'STORIA' ? 'Storia' : 'Epica'
  const priorityFieldId = `${uid}-priority`

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuovo elemento</DialogTitle>
          <DialogDescription>{TYPE_HINT[type]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tipo</legend>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {TYPES.map(t => (
                <label
                  key={t}
                  className={cn(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 text-sm transition-colors',
                    'hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
                    type === t ? 'border-primary bg-primary/5 font-medium text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-type`}
                    value={t}
                    checked={type === t}
                    onChange={() => changeType(t)}
                    className="sr-only"
                  />
                  <TypeIcon type={t} size="sm" />
                  {TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={titleId}>Titolo</Label>
            <Input
              id={titleId}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={type === 'TASK' ? 'Es. Aggiornare la pagina di login' : 'Titolo…'}
              autoFocus
              required
              autoComplete="off"
            />
          </div>

          {parentType && (
            <div className="space-y-2">
              <Label htmlFor={parentFieldId}>{parentLabel} di appartenenza</Label>
              {elementsQuery.isLoading ? (
                <Select disabled>
                  <SelectTrigger id={parentFieldId}><SelectValue placeholder="Caricamento…" /></SelectTrigger>
                </Select>
              ) : parentOptions.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  {parentType === 'STORIA'
                    ? 'Nessuna storia disponibile: il task non comparirà nel Kanban finché non viene collegato a una storia.'
                    : "Nessuna epica disponibile: la storia resterà nel gruppo «Senza epica»."}
                </p>
              ) : (
                <Select value={parentId || NO_PARENT} onValueChange={v => setParentId(v === NO_PARENT ? '' : v)}>
                  <SelectTrigger id={parentFieldId}>
                    <SelectValue placeholder="Seleziona…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>
                      <span className="text-muted-foreground">Nessuna</span>
                    </SelectItem>
                    {parentOptions.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex min-w-0 items-center gap-2">
                          <TypeIcon type={p.type} size="sm" />
                          <span className={cn('truncate', p.status === 'COMPLETATO' && 'text-muted-foreground')}>{p.title}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {hasPriority && (
            <div className="space-y-2">
              <Label htmlFor={priorityFieldId}>Priorità</Label>
              <Select value={priority} onValueChange={v => setPriority(v as ElementPriority)}>
                <SelectTrigger id={priorityFieldId} className="sm:w-56">
                  <SelectValue>
                    <PriorityIndicator priority={priority} variant="inline" showNone />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_ORDER.map(p => (
                    <SelectItem key={p} value={p}>
                      <PriorityIndicator priority={p} variant="inline" showNone />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:block">
              <Kbd>Invio</Kbd> per creare · <Kbd>Esc</Kbd> per annullare
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
              <Button type="submit" loading={loading} disabled={!title.trim()}>Crea</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
