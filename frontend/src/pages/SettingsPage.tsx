import { useRef, useState } from 'react'
import { usersApi, authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useTheme, THEMES } from '@/components/layout/ThemeProvider'
import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/toast'
import {
  notificationsSupported, notificationsEnabled, setNotificationsEnabled,
  notificationPermission, requestNotificationPermission,
} from '@/lib/notifications'
import { Camera, Check, Trash2, Palette, UserCircle, Lock, Bell } from 'lucide-react'

// Ridimensiona un'immagine lato client e la restituisce come data URI JPEG.
function fileToResizedDataUrl(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no ctx'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function SettingsPage() {
  const { user, updateUser, setTokens } = useAuthStore()
  const { theme, setTheme } = useTheme()
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
      const dataUrl = await fileToResizedDataUrl(file)
      const updated = await usersApi.updateProfile({ avatar: dataUrl })
      updateUser({ avatar: updated.avatar })
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
      updateUser({ avatar: undefined })
      toast('Foto rimossa')
    } catch {
      toast('Errore', 'destructive')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleSaveName = async () => {
    if (!displayName.trim()) return
    setSavingName(true)
    try {
      const updated = await usersApi.updateProfile({ displayName: displayName.trim() })
      updateUser({ displayName: updated.displayName })
      toast('Nome aggiornato')
    } catch {
      toast('Errore', 'destructive')
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
    if (next !== confirm) { setPwError('Le password non coincidono'); return }
    if (next.length < 8) { setPwError('Almeno 8 caratteri'); return }
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b shrink-0">
        <h1 className="text-lg font-semibold">Impostazioni</h1>
        <p className="text-xs text-muted-foreground">Profilo, aspetto e sicurezza</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto space-y-6">
        {/* Profilo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserCircle className="h-4 w-4" /> Profilo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-4">
              <UserAvatar
                name={user?.displayName}
                avatar={user?.avatar}
                className="h-16 w-16"
                fallbackClassName="text-lg"
              />
              <div className="flex flex-col gap-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={avatarBusy} onClick={() => fileRef.current?.click()}>
                    <Camera className="h-3.5 w-3.5 mr-1.5" />
                    {avatarBusy ? 'Attendere...' : 'Cambia foto'}
                  </Button>
                  {user?.avatar && (
                    <Button size="sm" variant="ghost" disabled={avatarBusy} onClick={handleRemoveAvatar}>
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Rimuovi
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">JPG o PNG. L'immagine viene ridimensionata automaticamente.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nome visualizzato</Label>
              <div className="flex gap-2">
                <Input value={displayName} onChange={e => setDisplayName(e.target.value)} />
                <Button
                  onClick={handleSaveName}
                  disabled={savingName || !displayName.trim() || displayName.trim() === user?.displayName}
                >
                  {savingName ? 'Salvataggio...' : 'Salva'}
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-muted-foreground">Email</Label>
              <p className="text-sm">{user?.email}</p>
            </div>
          </CardContent>
        </Card>

        {/* Aspetto */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4" /> Aspetto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {THEMES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={`flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                    theme === t.value ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent/50'
                  }`}
                >
                  <span className="h-5 w-5 rounded-full border border-border shrink-0" style={{ backgroundColor: t.swatch }} />
                  <span className="flex-1 text-left">{t.label}</span>
                  {theme === t.value && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Notifiche */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" /> Notifiche
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Notifiche dei nuovi messaggi</span>
                <span className="block text-xs text-muted-foreground">
                  Avviso quando ricevi un messaggio mentre l'app non è in primo piano.
                </span>
              </span>
              <input
                type="checkbox"
                checked={notifyOn}
                onChange={e => handleToggleNotifications(e.target.checked)}
                className="h-5 w-5 rounded border-input shrink-0"
              />
            </label>
            {!notificationsSupported() && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Questo browser non supporta le notifiche desktop.
              </p>
            )}
            {notificationsSupported() && notifyOn && perm === 'denied' && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Le notifiche sono bloccate nelle impostazioni del browser per questo sito: sbloccale per riceverle.
              </p>
            )}
            {notificationsSupported() && notifyOn && perm === 'default' && (
              <Button size="sm" variant="outline" onClick={() => requestNotificationPermission().then(setPerm)}>
                Consenti le notifiche
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Sicurezza */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4" /> Sicurezza
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
              <div className="space-y-1.5">
                <Label>Password attuale</Label>
                <Input type="password" value={current} onChange={e => setCurrent(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Nuova password</Label>
                <Input type="password" value={next} onChange={e => setNext(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Conferma nuova password</Label>
                <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
              {pwError && <p className="text-sm text-destructive">{pwError}</p>}
              <Button type="submit" disabled={pwBusy}>{pwBusy ? 'Aggiornamento...' : 'Cambia password'}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
