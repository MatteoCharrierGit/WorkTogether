import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/shared'
import { AuthField, AuthLayout, FormError } from './auth/AuthLayout'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [idError, setIdError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identifier.trim()) { setIdError('Inserisci username o email'); return }
    setIdError('')
    setError('')
    setLoading(true)
    try {
      const data = await authApi.login(identifier, password)
      // Primo accesso di un account creato col solo username: niente token, si va all'onboarding.
      if (data.onboardingRequired) {
        sessionStorage.setItem('wt-onboarding-token', data.onboardingToken)
        sessionStorage.setItem('wt-onboarding-name', data.displayName ?? '')
        navigate('/onboarding')
        return
      }
      setAuth(
        { id: data.userId, email: data.email, displayName: data.displayName, mustResetPassword: data.mustResetPassword, systemAdmin: data.systemAdmin, onboardingCompleted: data.onboardingCompleted, avatar: data.avatar },
        data.accessToken,
        data.refreshToken
      )
      if (data.mustResetPassword) {
        navigate('/force-reset')
      } else {
        navigate('/')
      }
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Credenziali non valide')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Accedi"
      description="Bentornato. Entra nel tuo spazio di lavoro."
      footer="Nessuna registrazione pubblica: per un account contatta il tuo admin."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <AuthField id="identifier" label="Username o email" error={idError}>
          <Input
            type="text"
            placeholder="mario.rossi o tu@esempio.it"
            value={identifier}
            onChange={e => { setIdentifier(e.target.value); if (idError) setIdError('') }}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
          />
        </AuthField>
        <AuthField
          id="password"
          label="Password"
          hint="Primo accesso? Inserisci solo lo username: imposterai email e password al passo successivo."
          aside={
            <Link to="/forgot-password" className="focus-ring rounded-sm text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Password dimenticata?
            </Link>
          }
        >
          <PasswordInput
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Lascia vuoto al primo accesso"
            autoComplete="current-password"
          />
        </AuthField>
        <FormError>{error}</FormError>
        <Button type="submit" className="w-full" loading={loading}>
          {loading ? 'Accesso in corso…' : 'Accedi'}
        </Button>
      </form>
    </AuthLayout>
  )
}
