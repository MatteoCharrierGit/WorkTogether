import * as React from 'react'
import type { WorkspaceRole } from '@/types'
import { SelectItem } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export { SettingsSection, SettingRow } from '@/components/shared'

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  ADMIN: 'Admin',
  COLLABORATORE: 'Collaboratore',
  GUEST: 'Guest',
}

/** Voci del Select ruolo (usate in creazione utente, invito e tabella membri). */
export function RoleSelectItems({ guestHint = true }: { guestHint?: boolean }) {
  return (
    <>
      <SelectItem value="ADMIN">Admin</SelectItem>
      <SelectItem value="COLLABORATORE">Collaboratore</SelectItem>
      <SelectItem value="GUEST">{guestHint ? 'Guest (solo lettura)' : 'Guest'}</SelectItem>
    </>
  )
}

/** Estrae il messaggio d'errore dalle risposte axios. */
export function apiError(err: unknown, fallback = 'Errore'): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback
}

/** Intestazione colonne visibile solo da md in su (le righe diventano card su mobile). */
export function ListHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      role="row"
      className={cn(
        'hidden border-b bg-surface-2 px-4 py-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground md:grid md:items-center md:gap-4',
        className
      )}
    >
      {children}
    </div>
  )
}
