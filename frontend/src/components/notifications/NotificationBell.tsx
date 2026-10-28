import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict, isToday } from 'date-fns'
import { it } from 'date-fns/locale'
import {
  AlarmClock, Bell, BellOff, CheckCheck, CircleDot, Clock, Settings2, UserPlus, Zap, type LucideIcon,
} from 'lucide-react'
import type { AppNotification, NotificationType, Workspace } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout, EmptyState, UserAvatar } from '@/components/shared'
import { useMediaQuery } from '@/components/calendar/use-media-query'
import { useWorkspaceStore } from '@/store/workspaceStore'
import {
  useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationsList, useUnreadNotificationsCount,
} from './useNotifications'

/** Icona + colore per i tipi senza autore (promemoria) e come fallback. */
const TYPE_ICON: Record<NotificationType, { icon: LucideIcon; className: string }> = {
  ASSIGNED: { icon: UserPlus, className: 'bg-primary/10 text-primary' },
  ELEMENT_STATUS: { icon: CircleDot, className: 'bg-info-subtle text-info' },
  DUE_SOON: { icon: Clock, className: 'bg-warning-subtle text-warning' },
  OVERDUE: { icon: AlarmClock, className: 'bg-destructive-subtle text-destructive' },
  SPRINT_STARTED: { icon: Zap, className: 'bg-success-subtle text-success' },
  SPRINT_CLOSED: { icon: Zap, className: 'bg-muted text-muted-foreground' },
  MENTION: { icon: Bell, className: 'bg-primary/10 text-primary' },
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  if (Date.now() - d.getTime() < 60_000) return 'ora'
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: it })
}

function NotificationItem({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const unread = !n.readAt
  const meta = TYPE_ICON[n.type] ?? TYPE_ICON.MENTION
  const Icon = meta.icon
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn(
          'focus-ring flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent',
          unread && 'bg-primary/5'
        )}
      >
        {n.actorName ? (
          <UserAvatar name={n.actorName} avatar={n.actorAvatar} size="sm" className="mt-0.5" />
        ) : (
          <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', meta.className)}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm leading-snug line-clamp-2', unread ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            {n.title}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <time dateTime={n.createdAt} className="shrink-0">{relativeTime(n.createdAt)}</time>
            {n.body && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{n.body}</span>
              </>
            )}
          </span>
        </span>
        {unread && (
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Non letta" role="img" />
        )}
      </button>
    </li>
  )
}

function NotificationPanel({ onNavigate }: { onNavigate: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setCurrent = useWorkspaceStore(s => s.setCurrent)
  const list = useNotificationsList()
  const { data: unread = 0 } = useUnreadNotificationsCount()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const items = useMemo(() => list.data?.pages.flat() ?? [], [list.data])
  const today = items.filter(n => isToday(new Date(n.createdAt)))
  const earlier = items.filter(n => !isToday(new Date(n.createdAt)))

  const open = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id)
    if (!n.link) return
    // Link a un altro workspace: lo si rende attivo prima di navigare.
    if (n.workspaceId && useWorkspaceStore.getState().current?.id !== n.workspaceId) {
      const ws = queryClient.getQueryData<Workspace[]>(['workspaces'])?.find(w => w.id === n.workspaceId)
      if (ws) setCurrent(ws)
    }
    onNavigate()
    navigate(n.link)
  }

  const section = (label: string, list: AppNotification[]) =>
    list.length > 0 && (
      <section aria-label={label}>
        <h3 className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
        <ul className="space-y-0.5">
          {list.map(n => <NotificationItem key={n.id} n={n} onOpen={open} />)}
        </ul>
      </section>
    )

  return (
    <div className="flex max-h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">Notifiche</h2>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => markAll.mutate()}
          disabled={unread === 0 || markAll.isPending}
          className="text-muted-foreground"
        >
          <CheckCheck className="h-3.5 w-3.5" /> Segna tutte come lette
        </Button>
        <IconButton
          size="xs"
          label="Preferenze notifiche"
          icon={<Settings2 />}
          onClick={() => { onNavigate(); navigate('/settings#notifiche-in-app') }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {list.isLoading ? (
          <div className="space-y-3 p-2" aria-busy="true" aria-label="Caricamento notifiche">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <Callout
            variant="destructive"
            title="Impossibile caricare le notifiche"
            className="m-2"
            action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Riprova</Button>}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="Nessuna notifica"
            description="Qui trovi assegnazioni, cambi di stato, scadenze e sprint che ti riguardano."
            size="sm"
          />
        ) : (
          <>
            {section('Oggi', today)}
            {section('Precedenti', earlier)}
            {list.hasNextPage && (
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  loading={list.isFetchingNextPage}
                  onClick={() => list.fetchNextPage()}
                >
                  Carica altre
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="shrink-0 border-t px-3 py-2 text-2xs text-muted-foreground">
        Le notifiche più vecchie di 60 giorni vengono eliminate. <Link to="/settings#notifiche-in-app" onClick={onNavigate} className="underline-offset-2 hover:text-foreground hover:underline">Preferenze</Link>
      </div>
    </div>
  )
}

export interface NotificationBellProps {
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  /** Lato del popover su desktop */
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
}

/** Campanella con badge dei non letti: Popover su desktop, Sheet dal basso su mobile. */
export function NotificationBell({ tooltipSide, side = 'right', align = 'start', className }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { data: unread = 0 } = useUnreadNotificationsCount()
  const label = unread > 0 ? `Notifiche (${unread} non lette)` : 'Notifiche'

  const button = (
    <IconButton
      label={label}
      tooltipSide={tooltipSide}
      icon={<Bell />}
      onClick={isDesktop ? undefined : () => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={open}
      noTooltip={open}
    />
  )
  const badge = unread > 0 && (
    <span
      className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-2xs font-semibold leading-none tabular-nums text-destructive-foreground ring-2 ring-background"
      aria-hidden="true"
    >
      {unread > 99 ? '99+' : unread}
    </span>
  )

  if (!isDesktop) {
    return (
      <span className={cn('relative inline-flex', className)}>
        {button}
        {badge}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" hideClose className="p-0" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Notifiche</SheetTitle>
            <NotificationPanel onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className={cn('relative inline-flex', className)}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        {badge}
      </span>
      <PopoverContent side={side} align={align} sideOffset={8} className="flex max-h-[min(32rem,80dvh)] w-96 max-w-[calc(100vw-2rem)] flex-col p-0">
        <NotificationPanel onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
