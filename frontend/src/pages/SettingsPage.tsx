import { useRef, useState } from 'react'
import { usersApi, authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useTheme, THEMES, ACCENTS } from '@/components/layout/ThemeProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { Callout, PageHeader, PasswordInput, SettingRow, SettingsSection, UserAvatar } from '@/components/shared'
import { getErrorMessage, resizeImageToDataUrl } from '@/lib/utils'
import {
  notificationsSupported, notificationsEnabled, setNotificationsEnabled,
  notificationPermission, requestNotificationPermission,
} from '@/lib/notifications'
import { InAppNotificationSettings } from '@/components/notifications/InAppNotificationSettings'
import { Camera, Check, Trash2, Palette, UserCircle, Lock, Bell, Sun, Moon, Monitor, Settings } from 'lucide-react'

export default function SettingsPage() {
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)
  const setTokens = useAuthStore(s => s.setTokens)
  const { theme, setTheme, accent, setAccent } = useTheme()
  const fileRef = useRef<HTMLInputElement>(null)

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [savingName, setSavingName] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const [notifyOn, setNotifyOn] = useState(notificationsEnabled())
  const [perm, setPerm] = useState(notificationPermission())

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast("Seleziona un'immagine", 'destructive'); return }
    setAvatarBusy(true)
    try {
      const dataUrl = await resizeImageToDataUrl(file)
      const updated = await usersApi.updateProfile({ avatar: dataUrl })
      // Il server salva i byte e risponde con un URL versionato (?v=N): cambia a ogni foto nuova.
      updateUser({ avatar: updated.avatarUrl ?? updated.avatar, avatarUrl: updated.avatarUrl ?? updated.avatar })
      toast('Foto aggiornata')
    } catch {
      toast('Errore nel caricamento della foto', 'destructive')
    } finally {
      setAvatarBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    setAvatarBusy(true)
    try {
      await usersApi.updateProfile({ avatar: '' })
      updateUser({ avatar: undefined, avatarUrl: undefined })
      toast('Foto rimossa')
    } catch (err) {
      toast(getErrorMessage(err, 'Impossibile rimuovere la foto'), 'destructive')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleSaveName = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!displayName.trim()) return
    setSavingName(true)
    try {
      const updated = await usersApi.updateProfile({ displayName: displayName.trim() })
      updateUser({ displayName: updated.displayName })
      toast('Nome aggiornato')
    } catch (err) {
      toast(getErrorMessage(err, 'Impossibile aggiornare il nome'), 'destructive')
    } finally {
      setSavingName(false)
    }
  }

  const handleToggleNotifications = async (on: boolean) => {
    setNotifyOn(on)
    setNotificationsEnabled(on)
    if (on && notificationPermission() === 'default') {
      const p = await requestNotificationPermission()
      setPerm(p)
      if (p === 'denied') toast('Notifiche bloccate dal browser', 'destructive')
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < 8) { setPwError('La nuova password deve avere almeno 8 caratteri'); return }
    if (next !== confirm) { setPwError('Le password non coincidono'); return }
    setPwError('')
    setPwBusy(true)
    try {
      const data = await authApi.resetPassword(current, next)
      setTokens(data.accessToken, data.refreshToken)
      setCurrent(''); setNext(''); setConfirm('')
      toast('Password aggiornata')
    } catch (err: any) {
      setPwError(err.response?.data?.error ?? 'Errore nel cambio password')
    } finally {
      setPwBusy(false)
    }
  }

  const nameUnchanged = !displayName.trim() || displayName.trim() === user?.displayName
  const mismatch = confirm.length > 0 && next !== confirm

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
        <PageHeader hideTitleOnMobile icon={Settings} title="Impostazioni" description="Profilo, aspetto, notifiche e sicurezza del tuo account" className="pb-0 sm:pb-0" />

        {/* Profilo */}
        <SettingsSection icon={UserCircle} title="Profilo" description="Come ti vedono gli altri membri." contentClassName="space-y-5">
          <div className="flex items-center gap-4">
            <UserAvatar name={user?.displayName} avatarUrl={user?.avatarUrl} avatar={user?.avatar} size="xl" />
            <div className="min-w-0 space-y-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" loading={avatarBusy} onClick={() => fileRef.current?.click()}>
                  {!avatarBusy && <Camera className="h-3.5 w-3.5" />} Cambia foto
                </Button>
                {(user?.avatarUrl || user?.avatar) && (
                  <Button size="sm" variant="ghost" disabled={avatarBusy} onClick={handleRemoveAvatar}>
                    <Trash2 className="h-3.5 w-3.5" /> Rimuovi
                  </Button>
                )}
              </div>
              <p className="text-caption text-muted-foreground">JPG o PNG. L&apos;immagine viene ridimensionata automaticamente.</p>
            </div>
          </div>

          <form onSubmit={handleSaveName} className="space-y-1.5">
            <Label htmlFor="settings-name">Nome visualizzato</Label>
            <div className="flex gap-2">
              <Input id="settings-name" value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" />
              <Button type="submit" variant="secondary" loading={savingName} disabled={nameUnchanged}>
                Salva
              </Button>
            </div>
          </form>

          <div className="space-y-1.5">
            <Label htmlFor="settings-email" className="text-muted-foreground">Email</Label>
            <Input id="settings-email" value={user?.email ?? ''} readOnly disabled />
          </div>
        </SettingsSection>

        {/* Aspetto */}
        <SettingsSection icon={Palette} title="Aspetto" description="Tema e colore d'accento valgono solo su questo dispositivo.">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Tema</Label>
                <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-2">
                  {THEMES.map(t => {
                    const Icon = t.value === 'light' ? Sun : t.value === 'dark' ? Moon : Monitor
                    const active = theme === t.value
                    return (
                      <button
                        key={t.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setTheme(t.value)}
                        className={`focus-ring flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-sm transition-colors sm:flex-row sm:justify-center ${
                          active ? 'border-primary bg-primary/5 text-foreground ring-1 ring-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Colore d'accento</Label>
                <div role="radiogroup" aria-label="Colore d'accento" className="flex flex-wrap gap-2.5">
                  {ACCENTS.map(a => {
                    const active = accent === a.value
                    return (
                      <button
                        key={a.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={a.label}
                        title={a.label}
                        onClick={() => setAccent(a.value)}
                        className={`focus-ring flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 ${
                          active ? 'ring-2 ring-offset-2 ring-offset-background' : ''
                        }`}
                        style={{ backgroundColor: a.swatch, ...(active ? { ['--tw-ring-color' as string]: a.swatch } : {}) }}
                      >
                        {active && <Check className="h-4 w-4 text-white" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
        </SettingsSection>

        {/* Notifiche */}
        <SettingsSection icon={Bell} title="Notifiche" contentClassName="space-y-3">
          <SettingRow
            htmlFor="settings-notify"
            label="Notifiche dei nuovi messaggi"
            description="Avviso quando ricevi un messaggio mentre l'app non è in primo piano."
          >
            <Switch
              id="settings-notify"
              checked={notifyOn}
              onCheckedChange={handleToggleNotifications}
              disabled={!notificationsSupported()}
            />
          </SettingRow>
          {!notificationsSupported() && (
            <Callout variant="warning">Questo browser non supporta le notifiche desktop.</Callout>
          )}
          {notificationsSupported() && notifyOn && perm === 'denied' && (
            <Callout variant="warning">
              Le notifiche sono bloccate nelle impostazioni del browser per questo sito: sbloccale per riceverle.
            </Callout>
          )}
          {notificationsSupported() && notifyOn && perm === 'default' && (
            <Callout
              variant="info"
              action={
                <Button size="sm" variant="outline" onClick={() => requestNotificationPermission().then(setPerm)}>
                  Consenti le notifiche
                </Button>
              }
            >
              Il browser non ha ancora concesso il permesso per le notifiche.
            </Callout>
          )}
        </SettingsSection>

        {/* Notifiche in app (campanella): preferenze per tipo, salvate sul server */}
        <InAppNotificationSettings />

        {/* Sicurezza */}
        <SettingsSection icon={Lock} title="Sicurezza" description="Cambia la password di accesso. Almeno 8 caratteri.">
          <form onSubmit={handleChangePassword} className="max-w-sm space-y-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">Password attuale</Label>
              <PasswordInput id="pw-current" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-next">Nuova password</Label>
              <PasswordInput id="pw-next" value={next} onChange={e => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">Conferma nuova password</Label>
              <PasswordInput
                id="pw-confirm"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? 'pw-confirm-err' : undefined}
              />
              {mismatch && <p id="pw-confirm-err" className="text-caption text-destructive">Le password non coincidono</p>}
            </div>
            {pwError && <p role="alert" className="text-sm text-destructive">{pwError}</p>}
            <Button type="submit" loading={pwBusy} disabled={!current || !next || !confirm}>Cambia password</Button>
          </form>
        </SettingsSection>
      </div>
    </div>
  )
}
