import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { workspacesApi, emailApi } from '@/lib/api'
import { Member, Workspace, WorkspaceRole } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/toast'
import { markdownToHtml } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { Sparkles, Send, Eye, Pencil } from 'lucide-react'

const ROLES: { value: WorkspaceRole; label: string }[] = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'COLLABORATORE', label: 'Collaboratori' },
  { value: 'GUEST', label: 'Guest' },
]

export default function MailPage() {
  const { wsId } = useParams<{ wsId: string }>()

  const { data: workspaces = [], isLoading: wsLoading } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const currentWs = workspaces.find(w => w.id === wsId)

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  const [roles, setRoles] = useState<WorkspaceRole[]>(['COLLABORATORE'])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [prompt, setPrompt] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState(false)

  // Solo gli admin del workspace possono accedere alla gestione mail.
  if (!wsLoading && currentWs && currentWs.myRole !== 'ADMIN') {
    return <Navigate to={`/workspace/${wsId}/kanban`} replace />
  }

  const toggleRole = (r: WorkspaceRole) =>
    setRoles(rs => rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r])
  const recipients = members.filter(m => roles.includes(m.role))

  const generate = async () => {
    if (!prompt.trim()) { toast('Scrivi una richiesta per Akari', 'destructive'); return }
    setDrafting(true)
    try {
      const d = await emailApi.draft(wsId!, { prompt: prompt.trim(), roles })
      if (d.subject) setSubject(d.subject)
      if (d.body) setBody(d.body)
      toast('Bozza generata da Akari')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Generazione non riuscita', 'destructive')
    } finally {
      setDrafting(false)
    }
  }

  const send = async () => {
    if (roles.length === 0 || !subject.trim() || !body.trim()) {
      toast('Seleziona i ruoli e compila oggetto e corpo', 'destructive'); return
    }
    if (recipients.length === 0) { toast('Nessun destinatario con i ruoli selezionati', 'destructive'); return }
    if (!confirm(`Inviare l'email a ${recipients.length} destinatari?`)) return
    setSending(true)
    try {
      const res = await emailApi.send(wsId!, { roles, subject: subject.trim(), body })
      toast(`Email inviata a ${res.recipientCount} destinatari`)
      setSubject(''); setBody(''); setPrompt(''); setPreview(false)
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Invio non riuscito', 'destructive')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b shrink-0">
        <h1 className="text-lg font-semibold">Mail</h1>
        <p className="text-xs text-muted-foreground">Scrivi e invia email ai membri del workspace · {currentWs?.name}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-5 max-w-2xl">
          <div className="space-y-2">
            <Label>Destinatari (per ruolo)</Label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map(r => {
                const active = roles.includes(r.value)
                const count = members.filter(m => m.role === r.value).length
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => toggleRole(r.value)}
                    className={cn('rounded-full border px-3 py-1 text-sm transition-colors',
                      active ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent')}
                  >
                    {r.label} ({count})
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {recipients.length > 0
                ? `${recipients.length} destinatari selezionati.`
                : 'Nessun destinatario con i ruoli selezionati.'}
            </p>
          </div>

          <Separator />

          {/* Bozza con Akari */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <Label className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Scrivi con Akari</Label>
            <div className="flex gap-2">
              <Input
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Es. avvisa che venerdì l'ufficio è chiuso e i task slittano a lunedì"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); generate() } }}
              />
              <Button type="button" variant="outline" onClick={generate} disabled={drafting} className="shrink-0">
                {drafting ? 'Genero...' : 'Genera'}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Oggetto</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Oggetto dell'email" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Messaggio (Markdown)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setPreview(p => !p)}
              >
                {preview
                  ? <><Pencil className="h-3.5 w-3.5 mr-1.5" /> Modifica</>
                  : <><Eye className="h-3.5 w-3.5 mr-1.5" /> Anteprima</>}
              </Button>
            </div>
            {preview ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none break-words min-h-[14rem] rounded-md border bg-card px-3 py-2"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(body) || '<p class="text-muted-foreground">Niente da mostrare.</p>' }}
              />
            ) : (
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={12}
                placeholder="Scrivi qui il corpo dell'email… Puoi usare Markdown (**grassetto**, elenchi, [link](url))."
                className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Il messaggio viene inviato formattato: il Markdown è convertito in HTML nell'email.
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={send} disabled={sending}>
              <Send className="h-4 w-4 mr-1.5" /> {sending ? 'Invio...' : `Invia a ${recipients.length}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
