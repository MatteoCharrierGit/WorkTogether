import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { workspacesApi } from '@/lib/api'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'

export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setCurrent = useWorkspaceStore(s => s.setCurrent)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const ws = await workspacesApi.create(name.trim(), description.trim() || undefined)
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      setCurrent(ws)
      toast('Workspace creato')
      setName('')
      setDescription('')
      onClose()
      navigate(`/workspace/${ws.id}/kanban`)
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
          <DialogTitle>Nuovo workspace</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
              placeholder="Es: Team Prodotto"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Descrizione (opzionale)</Label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="A cosa serve questo workspace?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Creazione...' : 'Crea'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
