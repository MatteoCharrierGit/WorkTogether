import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing } from 'lucide-react'
import { notificationsApi } from '@/lib/api'
import type { NotificationPreferences, NotificationType } from '@/types'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Callout, SettingRow, SettingsSection } from '@/components/shared'
import { getErrorMessage } from '@/lib/utils'

const PREFS_KEY = ['notification-preferences'] as const

const ROWS: { type: NotificationType; label: string; description: string }[] = [
  { type: 'ASSIGNED', label: 'Assegnazioni', description: 'Quando qualcuno ti assegna un task, una storia o un evento.' },
  { type: 'ELEMENT_STATUS', label: 'Cambi di stato', description: 'Quando un altro membro sposta un elemento a cui sei assegnato.' },
  { type: 'DUE_SOON', label: 'Scadenze in arrivo', description: 'Promemoria per i tuoi task che scadono entro 24 ore.' },
  { type: 'OVERDUE', label: 'Task scaduti', description: 'Un promemoria al giorno per i tuoi task scaduti e non completati.' },
  { type: 'SPRINT_STARTED', label: 'Avvio sprint', description: 'Quando parte una sprint in cui hai dei task.' },
  { type: 'SPRINT_CLOSED', label: 'Chiusura sprint', description: 'Quando viene chiusa una sprint in cui hai dei task.' },
]

export const IN_APP_NOTIFICATIONS_ANCHOR = 'notifiche-in-app'

/** Sezione "Notifiche in app" della pagina Impostazioni: on/off per tipo (salvataggio immediato). */
export function InAppNotificationSettings() {
  const queryClient = useQueryClient()
  const { hash } = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const query = useQuery({ queryKey: PREFS_KEY, queryFn: notificationsApi.getPreferences })

  // Link diretto dal pannello notifiche (/settings#notifiche-in-app).
  useEffect(() => {
    if (hash === `#${IN_APP_NOTIFICATIONS_ANCHOR}`) ref.current?.scrollIntoView({ block: 'start' })
  }, [hash, query.isSuccess])

  const mutation = useMutation({
    mutationFn: (changes: Partial<NotificationPreferences>) => notificationsApi.updatePreferences(changes),
    onMutate: changes => {
      const prev = queryClient.getQueryData<NotificationPreferences>(PREFS_KEY)
      if (prev) queryClient.setQueryData<NotificationPreferences>(PREFS_KEY, { ...prev, ...changes })
      return { prev }
    },
    onError: (err, _changes, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(PREFS_KEY, ctx.prev)
      toast(getErrorMessage(err, 'Impossibile salvare la preferenza'), 'destructive')
    },
    onSuccess: data => queryClient.setQueryData(PREFS_KEY, data),
  })

  return (
    <div id={IN_APP_NOTIFICATIONS_ANCHOR} ref={ref} className="scroll-mt-4">
      <SettingsSection
        icon={BellRing}
        title="Notifiche in app"
        description="Cosa compare nella campanella. Valgono su tutti i tuoi dispositivi."
        contentClassName="divide-y"
      >
        {query.isLoading ? (
          <div className="space-y-4" aria-busy="true">
            {ROWS.map(r => <Skeleton key={r.type} className="h-8 w-full" />)}
          </div>
        ) : query.isError ? (
          <Callout
            variant="destructive"
            title="Impossibile caricare le preferenze"
            action={<Button size="sm" variant="outline" onClick={() => query.refetch()}>Riprova</Button>}
          >
            {getErrorMessage(query.error)}
          </Callout>
        ) : (
          ROWS.map(r => (
            <SettingRow key={r.type} htmlFor={`notif-pref-${r.type}`} label={r.label} description={r.description}>
              <Switch
                id={`notif-pref-${r.type}`}
                checked={query.data?.[r.type] ?? true}
                onCheckedChange={v => mutation.mutate({ [r.type]: v })}
              />
            </SettingRow>
          ))
        )}
      </SettingsSection>
    </div>
  )
}
