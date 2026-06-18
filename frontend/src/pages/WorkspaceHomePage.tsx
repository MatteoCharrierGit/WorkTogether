import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { workspacesApi } from '@/lib/api'
import { Workspace } from '@/types'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Building2, Plus } from 'lucide-react'
import { CreateWorkspaceDialog } from '@/components/CreateWorkspaceDialog'

// Root redirect: if user is logged in and has workspaces, go to first workspace kanban
export default function WorkspaceHomePage() {
  const navigate = useNavigate()
  const { wsId } = useParams<{ wsId?: string }>()
  const { current, setCurrent } = useWorkspaceStore()
  const user = useAuthStore(s => s.user)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: workspacesApi.list,
  })

  useEffect(() => {
    if (wsId) {
      // entering a specific workspace
      const ws = workspaces.find(w => w.id === wsId)
      if (ws) { setCurrent(ws); navigate(`/workspace/${wsId}/kanban`, { replace: true }) }
    } else {
      // root: redirect to last used or first workspace
      const target = (current && workspaces.find(w => w.id === current.id)) || workspaces[0]
      if (target) navigate(`/workspace/${target.id}/kanban`, { replace: true })
    }
  }, [workspaces, wsId])

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-8">
        <Building2 className="h-12 w-12 text-muted-foreground/40" />
        <div>
          <h2 className="text-lg font-semibold">Nessun workspace</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {user?.systemAdmin
              ? 'Crea il primo workspace per iniziare.'
              : 'Chiedi al tuo admin di aggiungerti a un workspace.'}
          </p>
        </div>
        {user?.systemAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Crea workspace
          </Button>
        )}
        <CreateWorkspaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      </div>
    )
  }

  return null
}
