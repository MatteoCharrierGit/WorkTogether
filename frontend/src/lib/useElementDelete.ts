import { useQueryClient } from '@tanstack/react-query'
import { elementsApi } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { Element } from '@/types'

type DeletableElement = Pick<Element, 'id' | 'type' | 'title' | 'createdBy'>

const LABELS: Record<string, string> = {
  TASK: 'questo task',
  EVENTO: 'questo evento',
  STORIA: 'questa storia',
  EPICA: "questa epica",
}

/**
 * Logica condivisa di eliminazione di un elemento (task/evento/storia/epica).
 * Rispecchia i permessi del backend: gli admin possono sempre; gli altri solo gli elementi
 * che hanno creato e solo se TASK o EVENTO (epiche e storie sono riservate agli admin).
 */
export function useElementDelete(wsId?: string) {
  const queryClient = useQueryClient()
  const me = useAuthStore(s => s.user)
  const role = useWorkspaceStore(s => s.current?.myRole)

  const canDelete = (el: Pick<Element, 'type' | 'createdBy'>): boolean => {
    if (role === 'ADMIN') return true
    if (!me || el.createdBy !== me.id) return false
    return el.type === 'TASK' || el.type === 'EVENTO'
  }

  /** Chiede conferma ed elimina. Ritorna true se l'elemento è stato eliminato. */
  const remove = async (el: DeletableElement, opts?: { onDeleted?: () => void }): Promise<boolean> => {
    if (!wsId) return false
    const what = LABELS[el.type] ?? 'questo elemento'
    const name = el.title ? ` "${el.title}"` : ''
    if (!confirm(`Eliminare ${what}${name}? L'azione non è reversibile.`)) return false
    try {
      await elementsApi.delete(wsId, el.id)
      queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      toast('Elemento eliminato')
      opts?.onDeleted?.()
      return true
    } catch (err: any) {
      toast(err.response?.data?.error ?? 'Impossibile eliminare', 'destructive')
      return false
    }
  }

  return { canDelete, remove }
}
