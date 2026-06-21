import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { invitationsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { InvitationPreview } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Schermata di accettazione di un invito (link ricevuto via email: /invite/:token).
 * L'anteprima è pubblica; per accettare serve essere loggati con l'account invitato.
 */
export default function AcceptInvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const isAuthed = useAuthStore(s => !!s.accessToken)

  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    let active = true
    invitationsApi.preview(token)
      .then(p => { if (active) setPreview(p) })
      .catch(err => { if (active) setError(err.response?.data?.error ?? 'Invito non valido o scaduto') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  const accept = async () => {
    setError('')
    setAccepting(true)
    try {
      const inv = await invitationsApi.accept(token)
      // Forza il refetch della lista workspace al rientro nell'app.
      navigate(`/workspace/${inv.workspaceId}`)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Impossibile accettare l\'invito')
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Invito a un workspace</h1>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center">Caricamento…</p>
            ) : error && !preview ? (
              <>
                <p className="text-sm text-destructive text-center">{error}</p>
                <Link to="/" className="block text-center text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
                  Vai alla home
                </Link>
              </>
            ) : preview ? (
              <>
                <p className="text-sm text-center">
                  <strong>{preview.inviterName}</strong> ti ha invitato a unirti a{' '}
                  <strong>{preview.workspaceName}</strong> con il ruolo{' '}
                  <strong>{preview.role.toLowerCase()}</strong>.
                </p>
                {error && <p className="text-sm text-destructive text-center">{error}</p>}
                {isAuthed ? (
                  <>
                    <Button className="w-full" onClick={accept} disabled={accepting}>
                      {accepting ? 'Accetto…' : 'Accetta invito'}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Stai accedendo come {user?.displayName}. L&apos;invito è per {preview.email}.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground text-center">
                      Accedi con l&apos;account <strong>{preview.email}</strong> per accettare.
                    </p>
                    <Button className="w-full" asChild>
                      <Link to="/login">Accedi per accettare</Link>
                    </Button>
                  </>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
