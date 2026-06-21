import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Onboarding al primo accesso di un account creato col solo username.
 * Passo 1: scelta email + nuova password (parte un OTP all'email indicata).
 * Passo 2: conferma dell'OTP → l'account viene attivato e si entra nell'app.
 */
export default function OnboardingPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)

  const token = sessionStorage.getItem('wt-onboarding-token') || ''
  const name = sessionStorage.getItem('wt-onboarding-name') || ''

  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) navigate('/login')
  }, [token, navigate])

  const startSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Le password non coincidono'); return }
    if (password.length < 8) { setError('La password deve essere di almeno 8 caratteri'); return }
    setError('')
    setLoading(true)
    try {
      await authApi.onboardingStart(token, email, password)
      setStep(2)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Impossibile inviare il codice di verifica')
    } finally {
      setLoading(false)
    }
  }

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.onboardingVerify(token, code.trim())
      sessionStorage.removeItem('wt-onboarding-token')
      sessionStorage.removeItem('wt-onboarding-name')
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
          <h1 className="text-2xl font-semibold">Benvenuto{name ? `, ${name}` : ''}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === 1
              ? 'Completa il tuo account: imposta email e password.'
              : `Inserisci il codice a 6 cifre inviato a ${email}.`}
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {step === 1 ? (
              <form onSubmit={startSetup} className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="tu@esempio.it" />
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
                  {loading ? 'Invio codice...' : 'Invia codice di verifica'}
                </Button>
              </form>
            ) : (
              <form onSubmit={verify} className="space-y-4">
                <div className="space-y-2">
                  <Label>Codice di verifica</Label>
                  <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    value={code} onChange={e => setCode(e.target.value)} required autoFocus placeholder="123456" />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Verifica...' : 'Completa configurazione'}
                </Button>
                <button type="button" onClick={() => { setStep(1); setCode('') }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground">
                  Modifica email o password
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
