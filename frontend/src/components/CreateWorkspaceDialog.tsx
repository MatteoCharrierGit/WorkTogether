import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { workspacesApi } from '@/lib/api'
import { getErrorMessage } from '@/lib/utils'
import { useWorkspaceStore } from '@/store/workspaceStore'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toast'

export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setCurrent = useWorkspaceStore(s => s.setCurrent)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) { setName(''); setDescription('') }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const ws = await workspacesApi.create(name.trim(), description.trim() || undefined)
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      setCurrent(ws)
      toast('Workspace creato', 'success')
      onClose()
      navigate(`/workspace/${ws.id}/kanban`)
    } catch (err) {
      toast(getErrorMessage(err, 'Errore nella creazione'), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuovo workspace</DialogTitle>
          <DialogDescription>Uno spazio separato con i suoi progetti, file, chat e membri.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Nome</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
              maxLength={100}
              placeholder="Es. Team Prodotto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-desc">
              Descrizione <span className="font-normal text-muted-foreground">(opzionale)</span>
            </Label>
            <Textarea
              id="ws-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="A cosa serve questo workspace?"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Annulla</Button>
            <Button type="submit" loading={loading} disabled={!name.trim()}>Crea workspace</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
