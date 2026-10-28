import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Camera, LayoutGrid, Mail, Puzzle, Trash2, TriangleAlert } from 'lucide-react'
import { workspacesApi } from '@/lib/api'
import type { Workspace } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { Callout } from '@/components/shared'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { resizeImageToDataUrl } from '@/lib/utils'
import { SettingRow, SettingsSection, apiError } from './shared'

type WsSettings = Parameters<typeof workspacesApi.updateSettings>[1]
type BoolField = 'cardShowTags' | 'cardShowAssignees' | 'cardShowDueDate' | 'eventRemindersEnabled' | 'weeklyRecapEnabled' | 'mondayDigestEnabled'

const CARD_FIELDS: [BoolField, string, boolean][] = [
  ['cardShowTags', 'Mostra i tag', true],
  ['cardShowAssignees', 'Mostra gli assegnatari', true],
  ['cardShowDueDate', 'Mostra la scadenza', true],
]
const EMAIL_FIELDS: [BoolField, string, string | null, boolean][] = [
  ['eventRemindersEnabled', 'Promemoria eventi in arrivo', null, true],
  ['weeklyRecapEnabled', 'Recap della settimana', 'Il venerdì, scritto da Akari.', false],
  ['mondayDigestEnabled', 'Riepilogo "dove eravamo"', 'Il lunedì, scritto da Akari.', false],
]

// ─── Delete Workspace Dialog ───────────────────────────────────────────────────
function DeleteWorkspaceDialog({ wsId, wsName, open, onClose }: { wsId: string; wsName: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setCurrentStore = useWorkspaceStore(s => s.setCurrent)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const close = () => { setConfirmText(''); onClose() }

  const doDelete = async () => {
    setDeleting(true)
    try {
      await workspacesApi.deleteWorkspace(wsId)
      setCurrentStore(null)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast(`Workspace "${wsName}" eliminata`)
      navigate('/', { replace: true })
    } catch (err) {
      toast(apiError(err, 'Errore durante l\'eliminazione'), 'destructive')
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && !deleting && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminare il workspace?</DialogTitle>
          <DialogDescription>Questa azione è irreversibile.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={e => { e.preventDefault(); if (confirmText === wsName) doDelete() }}
        >
          <Callout variant="destructive">
            Elimina definitivamente membri, canali, messaggi, task, tag, file del Drive e ogni altro dato di <strong>&quot;{wsName}&quot;</strong>.
          </Callout>
          <label htmlFor="del-ws-confirm" className="block text-caption text-muted-foreground">
            Per confermare, scrivi <strong className="font-mono text-foreground">{wsName}</strong> qui sotto.
          </label>
          <Input
            id="del-ws-confirm"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={wsName}
            autoComplete="off"
            autoFocus
          />
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={close} disabled={deleting}>Annulla</Button>
            <Button type="submit" variant="destructive" disabled={confirmText !== wsName} loading={deleting}>
              {!deleting && <Trash2 className="h-3.5 w-3.5" />} Elimina definitivamente
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceTab({ wsId, workspace }: { wsId: string; workspace: Workspace | undefined }) {
  const queryClient = useQueryClient()
  const currentStoreId = useWorkspaceStore(s => s.current?.id)
  const setCurrentStore = useWorkspaceStore(s => s.setCurrent)
  const wsAvatarRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const applyWsSettings = useCallback(async (data: WsSettings, msg: string) => {
    // Aggiornamento ottimistico dei soli campi modificati: lo switch risponde subito.
    queryClient.setQueryData<Workspace[]>(['workspaces'], prev => prev?.map(w => (w.id === wsId ? { ...w, ...data } : w)))
    try {
      const updated = await workspacesApi.updateSettings(wsId, data)
      if (currentStoreId === wsId) setCurrentStore(updated)
      toast(msg)
    } catch (err) {
      toast(apiError(err), 'destructive')
    } finally {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  }, [wsId, queryClient, currentStoreId, setCurrentStore])

  const handleWsAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast("Seleziona un'immagine", 'destructive'); return }
    setAvatarBusy(true)
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256)
      await applyWsSettings({ avatar: dataUrl }, 'Immagine workspace aggiornata')
    } finally {
      setAvatarBusy(false)
      if (wsAvatarRef.current) wsAvatarRef.current.value = ''
    }
  }

  const reminderDays = workspace?.reminderDaysBefore ?? 1

  return (
    <div className="space-y-6">
      <SettingsSection icon={Building2} title="Immagine del workspace" description="Mostrata nello switcher dei workspace.">
        <div className="flex items-center gap-4">
          {workspace?.avatar ? (
            <img src={workspace.avatar} alt="" className="h-14 w-14 shrink-0 rounded-lg border object-cover" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary text-title text-primary-foreground">
              {workspace?.name?.[0]?.toUpperCase() ?? <Building2 className="h-6 w-6" />}
            </div>
          )}
          <div className="min-w-0 space-y-2">
            <p className="truncate text-sm font-medium">{workspace?.name}</p>
            <input ref={wsAvatarRef} type="file" accept="image/*" className="hidden" onChange={handleWsAvatar} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => wsAvatarRef.current?.click()} loading={avatarBusy}>
                {!avatarBusy && <Camera className="h-3.5 w-3.5" />} Cambia immagine
              </Button>
              {workspace?.avatar && (
                <Button size="sm" variant="ghost" onClick={() => applyWsSettings({ avatar: '' }, 'Immagine rimossa')} disabled={avatarBusy}>
                  <Trash2 className="h-3.5 w-3.5" /> Rimuovi
                </Button>
              )}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={LayoutGrid} title="Card della Kanban" description="Scegli quali informazioni mostrare nelle card dei task.">
        <div className="divide-y">
          {CARD_FIELDS.map(([field, label, def]) => {
            const value = workspace?.[field] ?? def
            return (
              <SettingRow key={field} htmlFor={`ws-${field}`} label={label}>
                <Switch
                  id={`ws-${field}`}
                  checked={value}
                  onCheckedChange={v => applyWsSettings({ [field]: v }, 'Impostazione aggiornata')}
                />
              </SettingRow>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection icon={Puzzle} title="Funzionalità" description="Attiva o nascondi sezioni del workspace per tutti i membri.">
        <SettingRow htmlFor="ws-sprint" label="Sprint" description="Mostra la sezione Sprint (gestione sprint).">
          <Switch
            id="ws-sprint"
            checked={workspace?.sprintEnabled ?? false}
            onCheckedChange={v => applyWsSettings({ sprintEnabled: v }, v ? 'Sezione Sprint attivata' : 'Sezione Sprint nascosta')}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        icon={Mail}
        title="Automazioni email"
        description="Email automatiche inviate ai membri del workspace. I recap di Akari richiedono l'agente AI attivo e una chiave OpenRouter configurata."
      >
        <div className="divide-y">
          {EMAIL_FIELDS.map(([field, label, hint, def]) => (
            <SettingRow key={field} htmlFor={`ws-${field}`} label={label} description={hint ?? undefined}>
              <Switch
                id={`ws-${field}`}
                checked={workspace?.[field] ?? def}
                onCheckedChange={v => applyWsSettings({ [field]: v }, 'Impostazione aggiornata')}
              />
            </SettingRow>
          ))}
          <SettingRow htmlFor="reminderDays" label="Anticipo dei promemoria" description="Giorni prima dell'evento (0–30).">
            <div className="flex items-center gap-2">
              <Input
                // key: se il valore cambia altrove l'input non controllato si riallinea
                key={`${wsId}-${reminderDays}`}
                id="reminderDays"
                type="number"
                inputMode="numeric"
                min={0}
                max={30}
                defaultValue={reminderDays}
                onBlur={e => {
                  const v = Math.max(0, Math.min(30, Number(e.target.value) || 0))
                  e.target.value = String(v)
                  if (v !== reminderDays) applyWsSettings({ reminderDaysBefore: v }, 'Impostazione aggiornata')
                }}
                className="h-8 w-20"
              />
              <span className="text-caption text-muted-foreground">giorni</span>
            </div>
          </SettingRow>
        </div>
      </SettingsSection>

      <SettingsSection
        tone="danger"
        icon={TriangleAlert}
        title="Zona pericolosa"
        description="Elimina definitivamente questo workspace e tutti i suoi dati: membri, canali, messaggi, task, tag e file del Drive. Non è recuperabile."
        actions={
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Elimina workspace
          </Button>
        }
      />

      <DeleteWorkspaceDialog
        wsId={wsId}
        wsName={workspace?.name ?? ''}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  )
}
