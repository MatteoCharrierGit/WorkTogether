import * as React from 'react'
import { SendHorizontal } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

export interface ChatComposerHandle {
  focus: () => void
  setValue: (v: string) => void
}

export interface ChatComposerProps {
  /**
   * Invio del testo (già trimmato). Il composer si svuota subito; se la Promise
   * viene rifiutata o risolve `false`, il testo viene ripristinato.
   */
  onSend: (text: string) => void | boolean | Promise<void | boolean>
  /** Chiamato a ogni modifica non vuota (es. per l'evento "sta scrivendo"). */
  onTyping?: () => void
  placeholder?: string
  /** Disabilita solo l'invio (si può continuare a scrivere). */
  busy?: boolean
  disabled?: boolean
  /** Cambiando chiave il contenuto si svuota e il campo riceve il focus (es. cambio canale). */
  resetKey?: string | null
  /** Contenuto sopra il campo (es. indicatore "sta scrivendo"). */
  top?: React.ReactNode
  autoFocus?: boolean
  className?: string
  /** Larghezza massima del contenuto (es. "max-w-3xl mx-auto"). */
  innerClassName?: string
  'aria-label'?: string
}

/**
 * Composer condiviso (chat e Akari): stato del testo locale, così digitare non
 * ri-renderizza la lista messaggi. Invio = invia, Shift+Invio = a capo.
 */
export const ChatComposer = React.memo(
  React.forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
    { onSend, onTyping, placeholder = 'Scrivi un messaggio…', busy, disabled, resetKey, top, autoFocus, className, innerClassName, ...rest },
    ref,
  ) {
    const [value, setValue] = React.useState('')
    const taRef = React.useRef<HTMLTextAreaElement>(null)

    React.useImperativeHandle(ref, () => ({
      focus: () => taRef.current?.focus(),
      setValue: (v: string) => setValue(v),
    }), [])

    // Cambio conversazione: svuota e porta il focus nel campo (solo su puntatori fini,
    // per non aprire la tastiera su mobile).
    React.useEffect(() => {
      setValue('')
      if (resetKey && window.matchMedia?.('(pointer: fine)').matches) taRef.current?.focus()
    }, [resetKey])

    const submit = async () => {
      const text = value.trim()
      if (!text || busy || disabled) return
      setValue('')
      try {
        const ok = await onSend(text)
        if (ok === false) setValue(prev => prev || text)
      } catch {
        setValue(prev => prev || text)
      }
    }

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submit()
      }
    }

    const canSend = !!value.trim() && !busy && !disabled

    return (
      <div className={cn('shrink-0 px-3 pb-3 sm:px-4', className)}>
        <div className={innerClassName}>
          {top}
          <div
            className={cn(
              'flex items-end gap-1 rounded-lg border border-input bg-card shadow-xs transition-[border-color,box-shadow]',
              'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20',
              disabled && 'opacity-60',
            )}
          >
            <Textarea
              ref={taRef}
              autoResize
              maxRows={8}
              rows={1}
              value={value}
              disabled={disabled}
              autoFocus={autoFocus}
              aria-label={rest['aria-label'] ?? 'Messaggio'}
              placeholder={placeholder}
              onChange={e => {
                setValue(e.target.value)
                if (e.target.value.trim()) onTyping?.()
              }}
              onKeyDown={onKeyDown}
              className="min-h-0 flex-1 border-0 bg-transparent py-2.5 shadow-none hover:border-0 focus-visible:ring-0"
            />
            <IconButton
              label="Invia (Invio)"
              icon={<SendHorizontal />}
              variant={canSend ? 'default' : 'ghost'}
              size="sm"
              className="m-1.5 shrink-0"
              disabled={!canSend}
              onClick={submit}
            />
          </div>
          <p className="mt-1 hidden px-1 text-2xs text-muted-foreground sm:block">
            <span className="font-medium">Invio</span> per inviare · <span className="font-medium">Shift + Invio</span> per andare a capo
          </p>
        </div>
      </div>
    )
  }),
)
