import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { workspacesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from '@/components/ui/toast'
import { Callout } from '@/components/shared'
import { useAuthStore } from '@/store/authStore'
import { SettingsSection } from './shared'

const EXPORT_SECTIONS: { id: 'settings' | 'members' | 'tags' | 'elements' | 'chat' | 'ai'; label: string; hint: string }[] = [
  { id: 'settings', label: 'Impostazioni', hint: 'Card Kanban, automazioni email, avatar' },
  { id: 'members', label: 'Membri e ruoli', hint: 'Riagganciati per email in fase di import' },
  { id: 'tags', label: 'Tag', hint: 'Etichette del workspace' },
  { id: 'elements', label: 'Epiche · Storie · Task · Eventi', hint: 'Tutta la gerarchia, con tag e assegnatari' },
  { id: 'chat', label: 'Chat', hint: 'Canali, stanze e messaggi' },
  { id: 'ai', label: 'Agente AI', hint: 'Configurazione di Akari (senza chiave API)' },
]

interface ImportResult {
  workspaceName: string; members: number; tags: number; elements: number
  channels: number; messages: number; aiImported: boolean; warnings: string[]
}

export function BackupTab({ wsId, wsName }: { wsId: string; wsName: string }) {
  const queryClient = useQueryClient()
  const isSystemAdmin = useAuthStore(s => !!s.user?.systemAdmin)
  const fileRef = useRef<HTMLInputElement>(null)
  const [sel, setSel] = useState<Record<string, boolean>>(
    () => Object.fromEntries(EXPORT_SECTIONS.map(s => [s.id, true]))
  )
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [newName, setNewName] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const toggle = (id: string) => setSel(s => ({ ...s, [id]: !s[id] }))

  const doExport = async () => {
    setExporting(true)
    try {
      const data = await workspacesApi.exportWorkspace(wsId, sel)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      const slug = wsName.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'workspace'
      a.href = url
      a.download = `worktogether-${slug}-${stamp}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Export completato: file scaricato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore durante l\'export', 'destructive')
    } finally {
      setExporting(false)
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const data = JSON.parse(await file.text())
      const res: ImportResult = await workspacesApi.importWorkspace(data, newName.trim() || undefined)
      setResult(res)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast(`Workspace "${res.workspaceName}" importata`)
    } catch (err: any) {
      const msg = err?.response?.data?.error
        ?? (err instanceof SyntaxError ? 'Il file non è un JSON valido' : 'Errore durante l\'import')
      toast(msg, 'destructive')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const allOn = EXPORT_SECTIONS.every(s => sel[s.id])
  const someOn = EXPORT_SECTIONS.some(s => sel[s.id])

  return (
    <div className="space-y-6">
      <SettingsSection
        icon={Download}
        title="Esporta (backup)"
        description="Un file JSON che è insieme backup, ripristino e trasporto della workspace. Esclusi: la chiave API dell'agente AI e i file binari del Drive."
        contentClassName="space-y-4"
      >
        <div className="overflow-hidden rounded-md border">
          <label htmlFor="exp-all" className="flex cursor-pointer select-none items-center gap-2.5 border-b bg-surface-2 px-3 py-2 text-caption font-medium text-muted-foreground">
            <Checkbox
              id="exp-all"
              checked={allOn ? true : someOn ? 'indeterminate' : false}
              onCheckedChange={() => setSel(Object.fromEntries(EXPORT_SECTIONS.map(s => [s.id, !allOn])))}
            />
            {allOn ? 'Deseleziona tutto' : 'Seleziona tutto'}
          </label>
          <div className="divide-y">
            {EXPORT_SECTIONS.map(s => (
              <label key={s.id} htmlFor={`exp-${s.id}`} className="flex cursor-pointer select-none items-start gap-2.5 px-3 py-2.5 text-sm hover:bg-accent/40 sm:items-center">
                <Checkbox id={`exp-${s.id}`} checked={!!sel[s.id]} onCheckedChange={() => toggle(s.id)} className="mt-0.5 sm:mt-0" />
                <span className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-4">
                  <span className="block font-medium">{s.label}</span>
                  <span className="block text-caption text-muted-foreground sm:text-right">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <Button onClick={doExport} loading={exporting} disabled={!someOn}>
          {!exporting && <Download className="h-4 w-4" />} Esporta JSON
        </Button>
      </SettingsSection>

      <SettingsSection
        icon={Upload}
        title="Importa (ripristino)"
        description={<>Carica un file esportato: viene creata una <strong>nuova</strong> workspace con dentro tutto ciò che il file contiene. Non sovrascrive nulla di esistente.</>}
        contentClassName="space-y-4"
      >
        {!isSystemAdmin ? (
          <Callout variant="warning" title="Serve un amministratore di sistema">
            L&apos;import crea una nuova workspace: chiedi al proprietario dell&apos;istanza.
          </Callout>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="imp-name">Nome della nuova workspace <span className="font-normal text-muted-foreground">(opzionale)</span></Label>
              <Input id="imp-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Lascia vuoto per usare il nome dal file" />
            </div>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} loading={importing}>
              {!importing && <Upload className="h-4 w-4" />} Scegli file e importa
            </Button>
          </>
        )}

        {result && (
          <Callout variant="success" title={`"${result.workspaceName}" importata`}>
            <p className="text-caption">
              {result.members} membri · {result.tags} tag · {result.elements} elementi · {result.channels} canali · {result.messages} messaggi{result.aiImported ? ' · AI' : ''}
            </p>
            {result.warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-caption font-medium text-warning">{result.warnings.length} avvisi</p>
                <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-2xs text-muted-foreground">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </Callout>
        )}
      </SettingsSection>
    </div>
  )
}
