import * as React from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface ConfirmOptions {
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Bottone di conferma rosso */
  destructive?: boolean
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Può essere async: il bottone mostra lo spinner finché la promise non si risolve */
  onConfirm: () => void | Promise<unknown>
}

/** Dialog di conferma controllato (alternativa accessibile a window.confirm). */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  destructive = false,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false)
  const handleConfirm = async () => {
    try {
      setBusy(true)
      await onConfirm()
      onOpenChange(false)
    } catch {
      /* il dialog resta aperto: l'errore va notificato da onConfirm (toast) */
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">Conferma l'azione</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm} loading={busy} autoFocus={!destructive}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

/**
 * Da montare una volta (App). Abilita `const confirm = useConfirm()`:
 *   if (!(await confirm({ title: 'Eliminare il file?', destructive: true, confirmLabel: 'Elimina' }))) return
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { open: boolean }) | null>(null)
  const resolver = React.useRef<((v: boolean) => void) | null>(null)

  const confirm = React.useCallback<ConfirmFn>(options => {
    // Se una conferma è già aperta, la precedente si considera annullata
    resolver.current?.(false)
    setState({ ...options, open: true })
    return new Promise<boolean>(resolve => {
      resolver.current = resolve
    })
  }, [])

  const settle = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setState(s => (s ? { ...s, open: false } : s))
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <AlertDialog open={state.open} onOpenChange={o => !o && settle(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{state.title}</AlertDialogTitle>
              {state.description ? (
                <AlertDialogDescription>{state.description}</AlertDialogDescription>
              ) : (
                <AlertDialogDescription className="sr-only">Conferma l'azione</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>{state.cancelLabel ?? 'Annulla'}</AlertDialogCancel>
              <Button variant={state.destructive ? 'destructive' : 'default'} onClick={() => settle(true)} autoFocus={!state.destructive}>
                {state.confirmLabel ?? 'Conferma'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </ConfirmContext.Provider>
  )
}

function plainText(node: React.ReactNode): string {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}

/**
 * Restituisce `confirm(options) => Promise<boolean>`.
 * Senza ConfirmProvider ricade su window.confirm (nessun crash).
 */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext)
  return React.useCallback<ConfirmFn>(
    options => {
      if (ctx) return ctx(options)
      const text = [plainText(options.title), plainText(options.description)].filter(Boolean).join('\n\n')
      return Promise.resolve(window.confirm(text))
    },
    [ctx]
  )
}
