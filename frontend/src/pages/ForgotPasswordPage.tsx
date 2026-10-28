import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Callout, PasswordInput } from '@/components/shared'
import { AuthField, AuthLayout, FormError } from './auth/AuthLayout'

/**
 * Reset password via OTP email.
 * Passo 1: username o email → invio del codice (risposta sempre positiva, niente enumerazione).
 * Passo 2: codice + nuova password → reset e accesso.
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)

  const [step, setStep] = useState<1 | 2>(1)
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({})
  const [loading, setLoading] = useState(false)

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.passwordResetRequest(identifier.trim())
      setStep(2)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Si è verificato un errore')
    } finally {
      setLoading(false)
    }
  }

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    const fe: typeof fieldErrors = {}
    if (password.length < 8) fe.password = 'La password deve essere di almeno 8 caratteri'
    if (password !== confirm) fe.confirm = 'Le password non coincidono'
    setFieldErrors(fe)
    if (fe.password || fe.confirm) return
    setError('')
    setLoading(true)
    try {
      const data = await authApi.passwordResetVerify(identifier.trim(), code.trim(), password)
      setAuth(
        { id: data.userId, email: data.email, displayName: data.displayName, mustResetPassword: data.mustResetPassword, systemAdmin: data.systemAdmin, onboardingCompleted: data.onboardingCompleted, avatar: data.avatar },
        data.accessToken,
        data.refreshToken
      )
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Codice non valido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Reimposta la password"
      description={step === 1
        ? 'Inserisci username o email: ti invieremo un codice.'
        : 'Inserisci il codice ricevuto via email e la nuova password.'}
      footer={
        <Link to="/login" className="focus-ring inline-flex items-center gap-1.5 rounded-sm underline-offset-4 hover:text-foreground hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Torna al login
        </Link>
      }
    >
      {step === 1 ? (
        <form onSubmit={requestCode} className="space-y-4">
          <AuthField id="fp-id" label="Username o email">
            <Input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} required autoFocus placeholder="mario.rossi o tu@esempio.it" autoComplete="username" autoCapitalize="none" />
          </AuthField>
          <FormError>{error}</FormError>
          <Button type="submit" className="w-full" loading={loading}>
            {loading ? 'Invio…' : 'Invia codice'}
          </Button>
        </form>
      ) : (
        <form onSubmit={resetPassword} className="space-y-4">
          <Callout variant="info">Se esiste un account con questi dati, hai ricevuto un codice via email.</Callout>
          <AuthField id="fp-code" label="Codice di verifica">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              placeholder="123456"
              className="h-11 text-center font-mono text-heading tracking-[0.5em]"
            />
          </AuthField>
          <AuthField id="fp-password" label="Nuova password" hint="Almeno 8 caratteri." error={fieldErrors.password}>
            <PasswordInput value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
          </AuthField>
          <AuthField id="fp-confirm" label="Conferma password" error={fieldErrors.confirm}>
            <PasswordInput value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
          </AuthField>
          <FormError>{error}</FormError>
          <Button type="submit" className="w-full" loading={loading}>
            {loading ? 'Salvataggio…' : 'Reimposta password'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { setStep(1); setCode(''); setError('') }}>
            Non hai ricevuto il codice? Richiedine un altro
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
