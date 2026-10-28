import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TypeIcon } from '@/components/shared'
import { elementsApi } from '@/lib/api'
import { cn, getErrorMessage } from '@/lib/utils'
import { ElementType } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useUiStore } from '@/store/uiStore'
import { toast } from '@/components/ui/toast'

const TYPES: { value: ElementType; label: string; created: string }[] = [
  { value: 'TASK', label: 'Task', created: 'Task creato' },
  { value: 'STORIA', label: 'Storia', created: 'Storia creata' },
  { value: 'EVENTO', label: 'Evento', created: 'Evento creato' },
]

/** Cattura rapida di un elemento nel workspace corrente. Si apre dalla palette comandi (⌘K → Nuova task). */
export function QuickCapture() {
  const open = useUiStore(s => s.quickCaptureOpen)
  const setOpen = useUiStore(s => s.setQuickCaptureOpen)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ElementType>('TASK')
  const [loading, setLoading] = useState(false)
  const workspace = useWorkspaceStore(s => s.current)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) { setTitle(''); setType('TASK') }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !workspace) return
    setLoading(true)
    try {
      const element = await elementsApi.create(workspace.id, { title: title.trim(), type })
      queryClient.invalidateQueries({ queryKey: ['elements', workspace.id] })
      toast(TYPES.find(t => t.value === type)?.created ?? 'Elemento creato', 'success')
      setOpen(false)
      navigate(`/workspace/${workspace.id}/element/${element.id}`)
    } catch (err) {
      toast(getErrorMessage(err), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open && !!workspace} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
            Cattura rapida
          </DialogTitle>
          <DialogDescription>
            In <span className="font-medium text-foreground">{workspace?.name}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div role="radiogroup" aria-label="Tipo di elemento" className="inline-flex rounded-md border bg-surface-2 p-0.5">
            {TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                onClick={() => setType(t.value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  type === t.value ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <TypeIcon type={t.value} size="sm" />
                {t.label}
              </button>
            ))}
          </div>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Titolo…"
            aria-label="Titolo"
            autoFocus
            required
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Annulla</Button>
            <Button type="submit" loading={loading} disabled={!title.trim()}>Crea</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
