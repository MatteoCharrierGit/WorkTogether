import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { elementsApi, tagsApi } from '@/lib/api'
import { ElementType } from '@/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
  defaultType?: ElementType
  defaultParentId?: string
}

export function CreateElementDialog({ open, onClose, workspaceId, defaultType = 'TASK', defaultParentId }: Props) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ElementType>(defaultType)
  const [parentId, setParentId] = useState(defaultParentId ?? '')
  const [loading, setLoading] = useState(false)

  const { data: elements = [] } = useQuery({
    queryKey: ['elements', workspaceId],
    queryFn: () => elementsApi.list(workspaceId),
    enabled: open,
  })

  const epics = elements.filter((e: any) => e.type === 'EPICA')
  const stories = elements.filter((e: any) => e.type === 'STORIA')

  const parentOptions = type === 'TASK' ? stories : type === 'STORIA' ? epics : []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    try {
      await elementsApi.create(workspaceId, {
        title: title.trim(),
        type,
        parentId: parentId || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['elements', workspaceId] })
      toast('Elemento creato')
      setTitle('')
      onClose()
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nella creazione', 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo elemento</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={v => setType(v as ElementType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EPICA">🚀 Epica</SelectItem>
                <SelectItem value="STORIA">📂 Storia</SelectItem>
                <SelectItem value="TASK">📝 Task</SelectItem>
                <SelectItem value="EVENTO">📅 Evento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Titolo</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titolo..."
              autoFocus
              required
            />
          </div>

          {parentOptions.length > 0 && (
            <div className="space-y-2">
              <Label>{type === 'TASK' ? 'Storia' : 'Epica'} di appartenenza</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona..." />
                </SelectTrigger>
                <SelectContent>
                  {parentOptions.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creazione...' : 'Crea'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
