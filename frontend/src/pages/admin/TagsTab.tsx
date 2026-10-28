import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Tag as TagIcon, Trash2 } from 'lucide-react'
import { tagsApi } from '@/lib/api'
import type { Tag } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { QueryState, TagChip, useConfirm } from '@/components/shared'
import { cn } from '@/lib/utils'
import { SettingsSection, apiError } from './shared'

// Colori rapidi proposti alla creazione (il selettore libero resta disponibile).
const PRESET_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b']

// ─── Create Tag Dialog ───────────────────────────────────────────────────────
function CreateTagDialog({ wsId, open, onClose }: { wsId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [loading, setLoading] = useState(false)

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await tagsApi.create(wsId, { name, color })
      queryClient.invalidateQueries({ queryKey: ['tags', wsId] })
      toast('Tag creato')
      onClose()
      setName(''); setColor('#6366f1')
    } catch (err) {
      toast(apiError(err), 'destructive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Nuovo tag</DialogTitle></DialogHeader>
        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Nome</Label>
            <Input id="tag-name" value={name} onChange={e => setName(e.target.value)} required placeholder="Es: Urgente" autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tag-color">Colore</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colori predefiniti">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'focus-ring flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110',
                    color === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="h-3.5 w-3.5 text-white" />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Input
                id="tag-color"
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="h-9 w-14 cursor-pointer p-1"
              />
              <span className="font-mono text-sm text-muted-foreground">{color}</span>
              <TagChip name={name || 'Anteprima'} color={color} className="ml-auto" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" loading={loading}>Crea</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TagsTab({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)

  const tagsQuery = useQuery<Tag[]>({
    queryKey: ['tags', wsId],
    queryFn: () => tagsApi.list(wsId),
    enabled: !!wsId,
  })

  const deleteTag = useCallback(async (tag: Tag) => {
    const ok = await confirm({
      title: `Eliminare il tag "${tag.name}"?`,
      description: 'Verrà rimosso da tutti gli elementi.',
      confirmLabel: 'Elimina',
      destructive: true,
    })
    if (!ok) return
    try {
      await tagsApi.delete(wsId, tag.id)
      queryClient.invalidateQueries({ queryKey: ['tags', wsId] })
      toast('Tag eliminato')
    } catch (err) {
      toast(apiError(err), 'destructive')
    }
  }, [wsId, queryClient, confirm])

  return (
    <SettingsSection
      icon={TagIcon}
      title="Tag"
      description="Etichette condivise per classificare task, storie ed eventi."
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Nuovo tag
        </Button>
      }
    >
      <QueryState
        query={tagsQuery}
        skeleton="table"
        rows={4}
        empty={{
          icon: TagIcon,
          title: 'Nessun tag',
          description: 'Creane uno per iniziare a classificare il lavoro.',
          size: 'sm',
          bordered: true,
        }}
      >
        {(tags: Tag[]) => (
          <ul className="divide-y overflow-hidden rounded-md border">
            {tags.map(tag => (
              <li key={tag.id} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/40 md:px-4">
                <div className="min-w-0 flex-1">
                  <TagChip tag={tag} />
                </div>
                <code className="hidden font-mono text-2xs text-muted-foreground sm:inline">{tag.color}</code>
                <IconButton
                  size="xs"
                  label={`Elimina tag ${tag.name}`}
                  icon={<Trash2 />}
                  className="hover:text-destructive"
                  onClick={() => deleteTag(tag)}
                />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <CreateTagDialog wsId={wsId} open={createOpen} onClose={() => setCreateOpen(false)} />
    </SettingsSection>
  )
}
