import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { elementsApi } from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { useConfirm } from '@/components/shared'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { getErrorMessage } from '@/lib/utils'
import { Element } from '@/types'

type DeletableElement = Pick<Element, 'id' | 'type' | 'title' | 'createdBy'>

const LABELS: Record<string, string> = {
  TASK: 'questo task',
  EVENTO: 'questo evento',
  STORIA: 'questa storia',
  EPICA: 'questa epica',
}

const TITLES: Record<string, string> = {
  TASK: 'Eliminare il task?',
  EVENTO: "Eliminare l'evento?",
  STORIA: 'Eliminare la storia?',
  EPICA: "Eliminare l'epica?",
}

/**
 * Logica condivisa di eliminazione di un elemento (task/evento/storia/epica).
 * Rispecchia i permessi del backend: gli admin possono sempre; gli altri solo gli elementi
 * che hanno creato e solo se TASK o EVENTO (epiche e storie sono riservate agli admin).
 * `canDelete` e `remove` sono stabili (useCallback): si possono passare a componenti memo.
 */
export function useElementDelete(wsId?: string) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const meId = useAuthStore(s => s.user?.id)
  const role = useWorkspaceStore(s => s.current?.myRole)

  const canDelete = useCallback(
    (el: Pick<Element, 'type' | 'createdBy'>): boolean => {
      if (role === 'ADMIN') return true
      if (!meId || el.createdBy !== meId) return false
      return el.type === 'TASK' || el.type === 'EVENTO'
    },
    [role, meId]
  )

  /** Chiede conferma ed elimina. Ritorna true se l'elemento è stato eliminato. */
  const remove = useCallback(
    async (el: DeletableElement, opts?: { onDeleted?: () => void }): Promise<boolean> => {
      if (!wsId) return false
      const what = LABELS[el.type] ?? 'questo elemento'
      const ok = await confirm({
        title: TITLES[el.type] ?? "Eliminare l'elemento?",
        description: el.title
          ? `Stai per eliminare ${what} «${el.title}». L'azione non è reversibile.`
          : `Stai per eliminare ${what}. L'azione non è reversibile.`,
        confirmLabel: 'Elimina',
        destructive: true,
      })
      if (!ok) return false
      try {
        await elementsApi.delete(wsId, el.id)
        queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
        toast('Elemento eliminato')
        opts?.onDeleted?.()
        return true
      } catch (err) {
        toast(getErrorMessage(err, 'Impossibile eliminare'), 'destructive')
        return false
      }
    },
    [wsId, confirm, queryClient]
  )

  return { canDelete, remove }
}
