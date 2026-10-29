import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { completeLogin, LoginError, logout } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { AuthLayout, FormError } from './auth/AuthLayout'

/** Rientro da Authentik (/callback): completa il login e apre la pagina richiesta. */
export default function CallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    completeLogin()
      .then(returnTo => { if (active) navigate(returnTo, { replace: true }) })
      .catch(e => { if (active) setError(e instanceof LoginError ? e.message : 'Accesso non riuscito') })
    return () => { active = false }
  }, [navigate])

  if (!error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background" aria-busy="true">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <p className="text-caption text-muted-foreground">Accesso in corso…</p>
      </div>
    )
  }

  return (
    <AuthLayout title="Accesso non riuscito" description="Authentik ti ha riconosciuto, ma l'accesso all'app non è andato a buon fine.">
      <div className="space-y-4">
        <FormError>{error}</FormError>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={() => window.location.assign('/login')}>Riprova</Button>
          <Button className="flex-1" variant="outline" onClick={() => void logout()}>Esci da Authentik</Button>
        </div>
      </div>
    </AuthLayout>
  )
}
