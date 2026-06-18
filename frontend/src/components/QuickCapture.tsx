import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { elementsApi } from '@/lib/api'
import { ElementType } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/components/ui/toast'
import { Zap } from 'lucide-react'

export function QuickCapture() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ElementType>('TASK')
  const [loading, setLoading] = useState(false)
  const workspace = useWorkspaceStore(s => s.current)
  const user = useAuthStore(s => s.user)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        if (workspace && user?.mustResetPassword === false) setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [workspace, user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !workspace) return
    setLoading(true)
    try {
      const element = await elementsApi.create(workspace.id, { title: title.trim(), type })
      queryClient.invalidateQueries({ queryKey: ['elements', workspace.id] })
      toast(`${type === 'TASK' ? 'Task' : type === 'EVENTO' ? 'Evento' : type} creato`)
      setTitle('')
      setOpen(false)
      navigate(`/workspace/${workspace.id}/element/${element.id}`)
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Cattura rapida
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Select value={type} onValueChange={v => setType(v as ElementType)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TASK">📝 Task</SelectItem>
              <SelectItem value="STORIA">📂 Storia</SelectItem>
              <SelectItem value="EVENTO">📅 Evento</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Titolo..."
            autoFocus
            required
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">in {workspace?.name}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Annulla</Button>
              <Button type="submit" size="sm" disabled={loading || !title.trim()}>
                {loading ? '...' : 'Crea'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
