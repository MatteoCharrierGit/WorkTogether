import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ForceResetPage() {
  const navigate = useNavigate()
  const { updateUser } = useAuthStore()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next !== confirm) { setError('Le password non coincidono'); return }
    if (next.length < 8) { setError('La password deve essere di almeno 8 caratteri'); return }
    setError('')
    setLoading(true)
    try {
      await authApi.resetPassword(current, next)
      updateUser({ mustResetPassword: false })
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Errore durante il reset')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">Imposta nuova password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per continuare devi cambiare la password temporanea.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Password attuale</Label>
                <Input type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Nuova password</Label>
                <Input type="password" value={next} onChange={e => setNext(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Conferma password</Label>
                <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Salvataggio...' : 'Imposta password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
