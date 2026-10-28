import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/shared'
import { AuthField, AuthLayout, FormError } from './auth/AuthLayout'

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
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) navigate('/login')
  }, [token, navigate])

  const startSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    const fe: typeof fieldErrors = {}
    if (password.length < 8) fe.password = 'La password deve essere di almeno 8 caratteri'
    if (password !== confirm) fe.confirm = 'Le password non coincidono'
    setFieldErrors(fe)
    if (fe.password || fe.confirm) return
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
    <AuthLayout
      title={`Benvenuto${name ? `, ${name}` : ''}`}
      description={step === 1
        ? 'Completa il tuo account: imposta email e password.'
        : <>Inserisci il codice a 6 cifre inviato a <strong className="text-foreground">{email}</strong>.</>}
      footer={<span>Passo {step} di 2</span>}
    >
      {step === 1 ? (
        <form onSubmit={startSetup} className="space-y-4">
          <AuthField id="ob-email" label="Email">
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus placeholder="tu@esempio.it" autoComplete="email" />
          </AuthField>
          <AuthField id="ob-password" label="Nuova password" hint="Almeno 8 caratteri." error={fieldErrors.password}>
            <PasswordInput value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
          </AuthField>
          <AuthField id="ob-confirm" label="Conferma password" error={fieldErrors.confirm}>
            <PasswordInput value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
          </AuthField>
          <FormError>{error}</FormError>
          <Button type="submit" className="w-full" loading={loading}>
            {loading ? 'Invio codice…' : 'Invia codice di verifica'}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <AuthField id="ob-code" label="Codice di verifica">
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
          <FormError>{error}</FormError>
          <Button type="submit" className="w-full" loading={loading} disabled={code.trim().length === 0}>
            {loading ? 'Verifica…' : 'Completa configurazione'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { setStep(1); setCode(''); setError('') }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Modifica email o password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
