import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { workspacesApi, emailApi } from '@/lib/api'
import { Member, Workspace, WorkspaceRole } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { PageHeader, AvatarStack, Callout, useConfirm } from '@/components/shared'
import { markdownToHtml } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import { Sparkles, Send, Eye, Pencil, Mail, Check } from 'lucide-react'

const ROLES: { value: WorkspaceRole; label: string }[] = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'COLLABORATORE', label: 'Collaboratori' },
  { value: 'GUEST', label: 'Ospiti' },
]

export default function MailPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const confirm = useConfirm()

  const { data: workspaces = [], isLoading: wsLoading } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })
  const currentWs = workspaces.find(w => w.id === wsId)

  const membersQuery = useQuery<Member[]>({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])

  const [roles, setRoles] = useState<WorkspaceRole[]>(['COLLABORATORE'])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [prompt, setPrompt] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState(false)

  const recipients = useMemo(() => members.filter(m => roles.includes(m.role)), [members, roles])
  const previewHtml = useMemo(() => (preview ? markdownToHtml(body) : ''), [preview, body])

  // Solo gli admin del workspace possono accedere alla gestione mail.
  if (!wsLoading && currentWs && currentWs.myRole !== 'ADMIN') {
    return <Navigate to={`/workspace/${wsId}/kanban`} replace />
  }

  const toggleRole = (r: WorkspaceRole) =>
    setRoles(rs => rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r])

  const generate = async () => {
    if (!prompt.trim()) { toast('Scrivi una richiesta per Akari', 'destructive'); return }
    setDrafting(true)
    try {
      const d = await emailApi.draft(wsId!, { prompt: prompt.trim(), roles })
      if (d.subject) setSubject(d.subject)
      if (d.body) setBody(d.body)
      toast('Bozza generata da Akari', 'success')
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
    const ok = await confirm({
      title: `Inviare l'email a ${recipients.length} destinatari?`,
      description: `Oggetto: “${subject.trim()}”. L'invio non può essere annullato.`,
      confirmLabel: 'Invia',
    })
    if (!ok) return
    setSending(true)
    try {
      const res = await emailApi.send(wsId!, { roles, subject: subject.trim(), body })
      toast(`Email inviata a ${res.recipientCount} destinatari`, 'success')
      setSubject(''); setBody(''); setPrompt(''); setPreview(false)
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Invio non riuscito', 'destructive')
    } finally {
      setSending(false)
    }
  }

  const canSend = roles.length > 0 && !!subject.trim() && !!body.trim() && recipients.length > 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
        <PageHeader
          className="hidden md:flex"
          icon={Mail}
          title="Mail"
          description={`Scrivi e invia email ai membri del workspace${currentWs ? ` · ${currentWs.name}` : ''}`}
          actions={
            <Button size="sm" onClick={send} loading={sending} disabled={!canSend} className="hidden lg:inline-flex">
              {!sending && <Send className="h-3.5 w-3.5" />} Invia a {recipients.length}
            </Button>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          {/* Composizione */}
          <div className="min-w-0 space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-heading">
                  <Sparkles className="h-4 w-4 text-primary" /> Scrivi con Akari
                </CardTitle>
                <CardDescription>Descrivi il messaggio: Akari prepara oggetto e testo, che puoi poi modificare.</CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={e => { e.preventDefault(); generate() }}
                >
                  <Input
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    aria-label="Richiesta per Akari"
                    placeholder="Es. avvisa che venerdì l'ufficio è chiuso e i task slittano a lunedì"
                  />
                  <Button type="submit" variant="secondary" loading={drafting} className="shrink-0">
                    {!drafting && <Sparkles className="h-4 w-4" />} {drafting ? 'Genero…' : 'Genera bozza'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-1.5">
              <Label htmlFor="mail-subject">Oggetto</Label>
              <Input id="mail-subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Oggetto dell'email" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="mail-body">Messaggio</Label>
                <Tabs value={preview ? 'preview' : 'edit'} onValueChange={v => setPreview(v === 'preview')}>
                  <TabsList className="h-8">
                    <TabsTrigger value="edit" className="px-2.5 text-caption"><Pencil className="h-3.5 w-3.5" /> Scrivi</TabsTrigger>
                    <TabsTrigger value="preview" className="px-2.5 text-caption"><Eye className="h-3.5 w-3.5" /> Anteprima</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {preview ? (
                <div className="min-h-64 rounded-md border bg-card px-4 py-3">
                  {subject.trim() && <p className="mb-3 border-b pb-2 text-heading">{subject}</p>}
                  {body.trim() ? (
                    <div className="prose prose-sm max-w-none break-words dark:prose-invert" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  ) : (
                    <p className="text-body text-muted-foreground">Niente da mostrare.</p>
                  )}
                </div>
              ) : (
                <Textarea
                  id="mail-body"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={14}
                  placeholder="Scrivi qui il corpo dell'email… Puoi usare Markdown (**grassetto**, elenchi, [link](url))."
                  className="min-h-64 resize-y font-mono text-body"
                />
              )}
              <p className="text-caption text-muted-foreground">
                Supporta Markdown: viene convertito in HTML nell'email.
              </p>
            </div>
          </div>

          {/* Destinatari + invio */}
          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-heading">Destinatari</CardTitle>
                <CardDescription>Per ruolo nel workspace</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1" role="group" aria-label="Ruoli destinatari">
                  {ROLES.map(r => {
                    const active = roles.includes(r.value)
                    const count = members.filter(m => m.role === r.value).length
                    return (
                      <button
                        key={r.value}
                        type="button"
                        role="checkbox"
                        aria-checked={active}
                        onClick={() => toggleRole(r.value)}
                        className={cn(
                          'focus-ring flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-body transition-colors',
                          active ? 'border-primary/40 bg-primary/10 text-foreground' : 'hover:bg-accent',
                        )}
                      >
                        <span className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong',
                        )}>
                          {active && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1">{r.label}</span>
                        <span className="text-caption tabular-nums text-muted-foreground">{membersQuery.isLoading ? '–' : count}</span>
                      </button>
                    )
                  })}
                </div>

                {membersQuery.isLoading ? (
                  <Skeleton className="h-6 w-32" />
                ) : membersQuery.isError ? (
                  <Callout
                    variant="destructive"
                    title="Membri non disponibili"
                    action={<Button size="sm" variant="outline" onClick={() => membersQuery.refetch()}>Riprova</Button>}
                  />
                ) : recipients.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <AvatarStack users={recipients.map(m => ({ id: m.userId, displayName: m.displayName, avatar: m.avatar }))} max={6} size="sm" />
                    <span className="text-caption text-muted-foreground">{recipients.length} destinatari</span>
                  </div>
                ) : (
                  <p className="text-caption text-muted-foreground">Nessun destinatario con i ruoli selezionati.</p>
                )}

                <Button onClick={send} loading={sending} disabled={!canSend} className="w-full">
                  {!sending && <Send className="h-4 w-4" />} {sending ? 'Invio…' : `Invia a ${recipients.length}`}
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}
