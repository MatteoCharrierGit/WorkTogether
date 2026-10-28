import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Building2, MailX } from 'lucide-react'
import { invitationsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { InvitationPreview } from '@/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared'
import { AuthLayout, FormError } from './auth/AuthLayout'

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Admin', COLLABORATORE: 'Collaboratore', GUEST: 'Guest' }

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
    <AuthLayout title="Invito a un workspace" description="Unisciti al team su WorkTogether.">
      {loading ? (
        <div className="space-y-3 rounded-lg border bg-card p-5" aria-busy="true">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error && !preview ? (
        <EmptyState
          icon={MailX}
          title="Invito non disponibile"
          description={error}
          bordered
          size="sm"
          action={<Button variant="outline" size="sm" asChild><Link to="/">Vai alla home</Link></Button>}
        />
      ) : preview ? (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-heading font-semibold">{preview.workspaceName}</p>
                <p className="truncate text-caption text-muted-foreground">Invitato da {preview.inviterName}</p>
              </div>
              <Badge variant="primary">{ROLE_LABELS[preview.role] ?? preview.role.toLowerCase()}</Badge>
            </div>
          </div>
          <FormError>{error}</FormError>
          {isAuthed ? (
            <>
              <Button className="w-full" onClick={accept} loading={accepting}>
                {accepting ? 'Accetto…' : 'Accetta invito'}
              </Button>
              <p className="text-center text-caption text-muted-foreground">
                Stai accedendo come <strong className="text-foreground">{user?.displayName}</strong>. L&apos;invito è per {preview.email}.
              </p>
            </>
          ) : (
            <>
              <Button className="w-full" asChild>
                <Link to="/login">Accedi per accettare</Link>
              </Button>
              <p className="text-center text-caption text-muted-foreground">
                Accedi con l&apos;account <strong className="text-foreground">{preview.email}</strong> per accettare.
              </p>
            </>
          )}
        </div>
      ) : null}
    </AuthLayout>
  )
}
