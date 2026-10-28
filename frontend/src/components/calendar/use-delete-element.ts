import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { elementsApi } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useConfirm } from '@/components/shared'
import { toast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/utils'
import type { Element } from '@/types'

const LABELS: Record<string, string> = {
  TASK: 'questo task',
  EVENTO: 'questo evento',
  STORIA: 'questa storia',
  EPICA: 'questa epica',
}

/**
 * Come useElementDelete di lib (stessi permessi), ma con conferma tramite useConfirm()
 * invece di window.confirm.
 */
export function useDeleteElement(wsId?: string) {
  const meId = useAuthStore(s => s.user?.id)
  const role = useWorkspaceStore(s => s.current?.myRole)
  // Stessi permessi del backend (e di useElementDelete): admin sempre; gli altri solo
  // TASK/EVENTO creati da loro. Funzione stabile, così le celle memoizzate non si ridisegnano.
  const canDelete = useCallback(
    (el: Pick<Element, 'type' | 'createdBy'>) => {
      if (role === 'ADMIN') return true
      if (!meId || el.createdBy !== meId) return false
      return el.type === 'TASK' || el.type === 'EVENTO'
    },
    [role, meId]
  )
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const remove = useCallback(
    async (el: Pick<Element, 'id' | 'type' | 'title'>) => {
      if (!wsId) return false
      const what = LABELS[el.type] ?? 'questo elemento'
      const ok = await confirm({
        title: `Eliminare ${what}?`,
        description: el.title ? `"${el.title}" verrà eliminato definitivamente. L'azione non è reversibile.` : "L'azione non è reversibile.",
        confirmLabel: 'Elimina',
        destructive: true,
      })
      if (!ok) return false
      try {
        await elementsApi.delete(wsId, el.id)
        queryClient.invalidateQueries({ queryKey: ['elements', wsId] })
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
        toast('Elemento eliminato')
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
