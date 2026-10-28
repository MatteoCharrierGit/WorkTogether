import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/shared'
import { AuthField, AuthLayout, FormError } from './auth/AuthLayout'

export default function ForceResetPage() {
  const navigate = useNavigate()
  const updateUser = useAuthStore(s => s.updateUser)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ next?: string; confirm?: string }>({})
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const fe: typeof fieldErrors = {}
    if (next.length < 8) fe.next = 'La password deve essere di almeno 8 caratteri'
    if (next !== confirm) fe.confirm = 'Le password non coincidono'
    setFieldErrors(fe)
    if (fe.next || fe.confirm) return
    setError('')
    setLoading(true)
    try {
      await authApi.resetPassword(current, next)
      updateUser({ mustResetPassword: false })
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Errore durante il reset')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Imposta nuova password"
      description="Per continuare devi cambiare la password temporanea."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField id="fr-current" label="Password attuale">
          <PasswordInput value={current} onChange={e => setCurrent(e.target.value)} required autoFocus autoComplete="current-password" />
        </AuthField>
        <AuthField id="fr-next" label="Nuova password" hint="Almeno 8 caratteri." error={fieldErrors.next}>
          <PasswordInput value={next} onChange={e => setNext(e.target.value)} required autoComplete="new-password" />
        </AuthField>
        <AuthField id="fr-confirm" label="Conferma password" error={fieldErrors.confirm}>
          <PasswordInput value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
        </AuthField>
        <FormError>{error}</FormError>
        <Button type="submit" className="w-full" loading={loading}>
          {loading ? 'Salvataggio…' : 'Imposta password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
