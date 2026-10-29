import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { login, oidcConfigured } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/shared'
import { AuthLayout, FormError } from './auth/AuthLayout'

/**
 * Schermata di accesso: l'autenticazione avviene su Authentik (account unico dei servizi).
 * Nessuna registrazione: gli account li crea l'amministratore.
 */
export default function LoginPage() {
  const [params] = useSearchParams()
  const status = useAuthStore(s => s.status)
  const storeError = useAuthStore(s => s.error)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const returnTo = params.get('returnTo') ?? '/'
  if (status === 'authenticated') return <Navigate to={returnTo} replace />

  const expired = params.get('expired') === '1'

  const start = async () => {
    setError('')
    setLoading(true)
    try {
      await login(returnTo) // redirect: la pagina viene lasciata
    } catch {
      setError('Impossibile raggiungere il servizio di accesso. Riprova tra poco.')
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Accedi"
      description="Bentornato. Entra nel tuo spazio di lavoro con il tuo account."
      footer="Nessuna registrazione pubblica: per un account contatta il tuo admin."
    >
      <div className="space-y-4">
        {expired && !storeError && !error && (
          <Callout variant="info">La sessione è scaduta: accedi di nuovo per continuare.</Callout>
        )}
        {!oidcConfigured && (
          <Callout variant="destructive">
            Accesso non configurato: manca <code>VITE_OIDC_AUTHORITY</code> nella build del frontend.
          </Callout>
        )}
        <FormError>{storeError || error}</FormError>
        <Button className="w-full" onClick={start} loading={loading} disabled={!oidcConfigured || status === 'loading'}>
          {!loading && <LogIn className="h-4 w-4" />}
          {loading ? 'Reindirizzamento…' : 'Accedi con Authentik'}
        </Button>
        <p className="text-center text-caption text-muted-foreground lg:text-left">
          Verrai portato alla pagina di accesso comune ai servizi e poi riportato qui.
        </p>
      </div>
    </AuthLayout>
  )
}
