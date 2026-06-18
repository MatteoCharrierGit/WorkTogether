import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { elementsApi, tagsApi, workspacesApi, attachmentsApi } from '@/lib/api'
import { Element, ElementStatus, Attachment } from '@/types'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { BlockEditor } from '@/components/editor/BlockEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn, STATUS_LABELS, TYPE_ICONS, formatDate, getInitials, STATUS_COLORS, formatBytes } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { UserAvatar } from '@/components/UserAvatar'
import { Calendar, User, Tag, Save, Paperclip, Download, Trash2, Upload } from 'lucide-react'

export default function ElementDetailPage() {
  const { wsId, elementId } = useParams<{ wsId: string; elementId: string }>()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceStore(s => s.current)
  const isGuest = workspace?.myRole === 'GUEST'

  const { data: element, isLoading } = useQuery<Element>({
    queryKey: ['element', wsId, elementId],
    queryFn: () => elementsApi.get(wsId!, elementId!),
    enabled: !!wsId && !!elementId,
  })

  const { data: allElements = [] } = useQuery<Element[]>({
    queryKey: ['elements', wsId],
    queryFn: () => elementsApi.list(wsId!),
    enabled: !!wsId,
  })

  const { data: tags = [] } = useQuery({
    queryKey: ['tags', wsId],
    queryFn: () => tagsApi.list(wsId!),
    enabled: !!wsId,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['members', wsId],
    queryFn: () => workspacesApi.getMembers(wsId!),
    enabled: !!wsId,
  })

  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['attachments', wsId, elementId],
    queryFn: () => attachmentsApi.list(wsId!, elementId!),
    enabled: !!wsId && !!elementId,
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState<string | undefined>()
  const [status, setStatus] = useState<ElementStatus>('DA_FARE')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (element) {
      setTitle(element.title)
      setBody(element.body)
      setStatus(element.status)
      setStartDate(element.startDate ? element.startDate.slice(0, 10) : '')
      setEndDate(element.endDate ? element.endDate.slice(0, 10) : '')
      setAllDay(!!element.allDay)
      setDirty(false)
    }
  }, [element])

  // 'YYYY-MM-DD' -> ISO a mezzogiorno UTC (evita slittamenti di giorno per fuso orario)
  const toIso = (d: string) => (d ? `${d}T12:00:00Z` : undefined)

  const save = async () => {
    if (!element || !wsId) return
    setSaving(true)
    try {
      await elementsApi.update(wsId, element.id, {
        ...element,
        title,
        body,
        status,
        startDate: toIso(startDate),
        endDate: allDay ? undefined : toIso(endDate),
        allDay,
        tagIds: element.tags.map(t => t.id),
        assigneeIds: element.assignees.map(a => a.id),
      })
      queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
      queryClient.invalidateQueries({ queryKey: ['element', wsId, elementId] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      setDirty(false)
      toast('Salvato')
    } catch {
      toast('Errore nel salvataggio', 'destructive')
    } finally {
      setSaving(false)
    }
  }

  const toggleTag = async (tagId: string) => {
    if (!element || !wsId) return
    const has = element.tags.some(t => t.id === tagId)
    const newTagIds = has ? element.tags.filter(t => t.id !== tagId).map(t => t.id) : [...element.tags.map(t => t.id), tagId]
    await elementsApi.update(wsId, element.id, { ...element, tagIds: newTagIds, assigneeIds: element.assignees.map(a => a.id) })
    queryClient.invalidateQueries({ queryKey: ['element', wsId, elementId] })
    queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
    queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
  }

  const toggleAssignee = async (userId: string) => {
    if (!element || !wsId) return
    const has = element.assignees.some(a => a.id === userId)
    const newIds = has ? element.assignees.filter(a => a.id !== userId).map(a => a.id) : [...element.assignees.map(a => a.id), userId]
    await elementsApi.update(wsId, element.id, { ...element, assigneeIds: newIds, tagIds: element.tags.map(t => t.id) })
    queryClient.invalidateQueries({ queryKey: ['element', wsId, elementId] })
    queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
    queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !wsId || !elementId) return
    setUploading(true)
    try {
      await attachmentsApi.upload(wsId, elementId, file)
      queryClient.invalidateQueries({ queryKey: ['attachments', wsId, elementId] })
      toast('File caricato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore nel caricamento', 'destructive')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDownload = async (att: Attachment) => {
    if (!wsId || !elementId) return
    try {
      await attachmentsApi.download(wsId, elementId, att.id, att.filename)
    } catch {
      toast('Errore nel download', 'destructive')
    }
  }

  const handleDeleteAttachment = async (att: Attachment) => {
    if (!wsId || !elementId) return
    if (!confirm(`Eliminare "${att.filename}"?`)) return
    try {
      await attachmentsApi.delete(wsId, elementId, att.id)
      queryClient.invalidateQueries({ queryKey: ['attachments', wsId, elementId] })
      toast('Allegato eliminato')
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Errore', 'destructive')
    }
  }

  // Build breadcrumbs
  const crumbs = (() => {
    if (!element) return []
    const result = []
    const wsBase = `/workspace/${wsId}`
    result.push({ label: workspace?.name ?? 'Workspace', href: `${wsBase}/kanban` })
    if (element.parentId) {
      const parent = allElements.find(e => e.id === element.parentId)
      if (parent) {
        if (parent.parentId) {
          const grandparent = allElements.find(e => e.id === parent.parentId)
          if (grandparent) result.push({ label: grandparent.title, type: grandparent.type, href: `${wsBase}/element/${grandparent.id}` })
        }
        result.push({ label: parent.title, type: parent.type, href: `${wsBase}/element/${parent.id}` })
      }
    }
    result.push({ label: element.title, type: element.type })
    return result
  })()

  if (isLoading) return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Caricamento...</div>
  if (!element) return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Elemento non trovato</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
        <Breadcrumbs items={crumbs} />
        {!isGuest && dirty && (
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? 'Salvataggio...' : 'Salva'}
          </Button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto px-10 py-8 max-w-4xl">
          {/* Type badge */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">{TYPE_ICONS[element.type]}</span>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{element.type}</span>
            {element.type === 'EPICA' && element.progress != null && (
              <div className="flex items-center gap-2 ml-4">
                <Progress value={element.progress} className="h-1.5 w-24" />
                <span className="text-xs text-muted-foreground">{element.progress}%</span>
              </div>
            )}
          </div>

          {/* Title */}
          {isGuest ? (
            <h1 className="text-2xl font-semibold mb-6">{element.title}</h1>
          ) : (
            <input
              value={title}
              onChange={e => { setTitle(e.target.value); setDirty(true) }}
              className="w-full text-2xl font-semibold bg-transparent border-none outline-none mb-6 placeholder:text-muted-foreground/50"
              placeholder="Titolo elemento..."
            />
          )}

          {/* Body */}
          <BlockEditor
            content={body}
            onChange={v => { setBody(v); setDirty(true) }}
            readOnly={isGuest}
            placeholder="Aggiungi una descrizione..."
          />

          {/* Attachments */}
          <div className="mt-10">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" /> Allegati
                {attachments.length > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">({attachments.length})</span>
                )}
              </h3>
              {!isGuest && (
                <>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    {uploading ? 'Caricamento...' : 'Carica file'}
                  </Button>
                </>
              )}
            </div>

            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nessun allegato.</p>
            ) : (
              <div className="space-y-1.5">
                {attachments.map(att => (
                  <div
                    key={att.id}
                    className="group flex items-center gap-3 rounded-lg border px-3 py-2 hover:bg-muted/30 transition-colors"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{att.filename}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(att.sizeBytes)}</p>
                    </div>
                    <button
                      onClick={() => handleDownload(att)}
                      className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="Scarica"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    {!isGuest && (
                      <button
                        onClick={() => handleDeleteAttachment(att)}
                        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                        title="Elimina"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-64 shrink-0 border-l overflow-y-auto p-4 space-y-5">
          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">Stato</label>
            {isGuest ? (
              <span className={cn('text-sm font-medium', STATUS_COLORS[element.status])}>{STATUS_LABELS[element.status]}</span>
            ) : (
              <Select value={status} onValueChange={v => { setStatus(v as ElementStatus); setDirty(true) }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['DA_FARE', 'IN_CORSO', 'COMPLETATO', 'ARCHIVIATO'] as ElementStatus[]).map(s => (
                    <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Separator />

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Tag className="h-3 w-3" /> Tag
            </label>
            <div className="flex flex-wrap gap-1">
              {(tags as any[]).map((tag: any) => {
                const active = element.tags.some(t => t.id === tag.id)
                return (
                  <button
                    key={tag.id}
                    disabled={isGuest && !active}
                    onClick={() => !isGuest && toggleTag(tag.id)}
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-opacity',
                      !active && 'opacity-30',
                      !isGuest && 'cursor-pointer hover:opacity-100'
                    )}
                    style={{ backgroundColor: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
                  >
                    {tag.name}
                  </button>
                )
              })}
              {(tags as any[]).length === 0 && <span className="text-xs text-muted-foreground">Nessun tag</span>}
            </div>
          </div>

          <Separator />

          {/* Assignees */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> Assegnatari
            </label>
            <div className="space-y-1">
              {(members as any[]).map((m: any) => {
                const active = element.assignees.some(a => a.id === m.userId)
                return (
                  <button
                    key={m.userId}
                    disabled={isGuest && !active}
                    onClick={() => !isGuest && toggleAssignee(m.userId)}
                    className={cn(
                      'flex items-center gap-2 w-full rounded-md px-2 py-1 text-xs transition-colors',
                      active ? 'bg-accent' : 'opacity-50 hover:opacity-80',
                      !isGuest && 'cursor-pointer hover:bg-accent'
                    )}
                  >
                    <UserAvatar name={m.displayName} avatar={m.avatar} className="h-5 w-5" fallbackClassName="text-[9px]" />
                    <span className="truncate">{m.displayName}</span>
                    {active && <span className="ml-auto text-primary text-[10px]">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <Separator />

          {/* Dates */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> Date
            </label>
            <div className="text-xs space-y-2 text-muted-foreground">
              {isGuest ? (
                <>
                  <div className="flex justify-between">
                    <span>Inizio</span>
                    <span>{formatDate(element.startDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Fine</span>
                    <span>{formatDate(element.endDate)}</span>
                  </div>
                </>
              ) : (
                <>
                  {element.type === 'EVENTO' && (
                    <label className="flex items-center gap-2 cursor-pointer select-none text-foreground">
                      <input
                        type="checkbox"
                        checked={allDay}
                        onChange={e => { setAllDay(e.target.checked); setDirty(true) }}
                        className="h-3.5 w-3.5 rounded border-input"
                      />
                      Giornata intera
                    </label>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span>{allDay && element.type === 'EVENTO' ? 'Data' : 'Inizio'}</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => { setStartDate(e.target.value); setDirty(true) }}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                    />
                  </div>
                  {!(allDay && element.type === 'EVENTO') && (
                    <div className="flex items-center justify-between gap-2">
                      <span>Fine</span>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate || undefined}
                        onChange={e => { setEndDate(e.target.value); setDirty(true) }}
                        className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      />
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between">
                <span>Creato</span>
                <span>{formatDate(element.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
