import { AlertCircle, Check, RotateCw } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SaveStatus } from './useElementAutosave'

/** Indicatore discreto dello stato dell'autosave ("Salvataggio…", "Salvato", errore + Riprova). */
export function SaveIndicator({
  status,
  error,
  onRetry,
  className,
}: {
  status: SaveStatus
  error?: string | null
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5 text-caption text-muted-foreground', className)} aria-live="polite">
      {status === 'pending' && (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
          <span className="hidden sm:inline">Modifiche non salvate</span>
          <span className="sr-only sm:hidden">Modifiche non salvate</span>
        </>
      )}
      {status === 'saving' && (
        <>
          <Spinner size="xs" label="Salvataggio in corso" />
          <span className="hidden sm:inline">Salvataggio…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          <span className="hidden sm:inline">Salvato</span>
          <span className="sr-only sm:hidden">Salvato</span>
        </>
      )}
      {status === 'error' && (
        <>
          <SimpleTooltip content={error ?? 'Salvataggio non riuscito'}>
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Non salvato</span>
            </span>
          </SimpleTooltip>
          {onRetry && (
            <Button size="xs" variant="outline" onClick={onRetry}>
              <RotateCw className="h-3 w-3" /> Riprova
            </Button>
          )}
        </>
      )}
    </div>
  )
}
