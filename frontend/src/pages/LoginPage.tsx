import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">WorkTogether</h1>
          <p className="text-sm text-muted-foreground mt-1">Accedi al tuo account</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">Username o email</Label>
                <Input
                  id="identifier"
                  type="text"
                  placeholder="mario.rossi o tu@esempio.it"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Lascia vuoto al primo accesso"
                />
                <p className="text-xs text-muted-foreground">
                  Primo accesso? Inserisci solo lo username: imposterai email e password al passo successivo.
                </p>
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Accesso in corso...' : 'Accedi'}
              </Button>
              <div className="text-center">
                <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
                  Password dimenticata?
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Nessuna registrazione pubblica. Contatta il tuo admin.
        </p>
      </div>
    </div>
  )
}
