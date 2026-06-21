import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

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
    if (password !== confirm) { setError('Le password non coincidono'); return }
    if (password.length < 8) { setError('La password deve essere di almeno 8 caratteri'); return }
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Reimposta la password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === 1
              ? 'Inserisci username o email: ti invieremo un codice.'
              : 'Inserisci il codice ricevuto via email e la nuova password.'}
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {step === 1 ? (
              <form onSubmit={requestCode} className="space-y-4">
                <div className="space-y-2">
                  <Label>Username o email</Label>
                  <Input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)} required autoFocus placeholder="mario.rossi o tu@esempio.it" />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Invio...' : 'Invia codice'}
                </Button>
              </form>
            ) : (
              <form onSubmit={resetPassword} className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Se esiste un account con questi dati, hai ricevuto un codice via email.
                </p>
                <div className="space-y-2">
                  <Label>Codice di verifica</Label>
                  <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    value={code} onChange={e => setCode(e.target.value)} required autoFocus placeholder="123456" />
                </div>
                <div className="space-y-2">
                  <Label>Nuova password</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Conferma password</Label>
                  <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Salvataggio...' : 'Reimposta password'}
                </Button>
              </form>
            )}
            <div className="mt-4 text-center">
              <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
                Torna al login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
