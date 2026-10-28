import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Cresce con il contenuto fino a maxRows (default 12) */
  autoResize?: boolean
  maxRows?: number
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize = false, maxRows = 12, onInput, value, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)
    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    }

    const resize = React.useCallback(() => {
      const el = innerRef.current
      if (!el || !autoResize) return
      el.style.height = 'auto'
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
      const max = lh * maxRows + 16
      el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`
      el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden'
    }, [autoResize, maxRows])

    React.useLayoutEffect(resize, [resize, value])

    return (
      <textarea
        ref={setRefs}
        value={value}
        onInput={e => {
          resize()
          onInput?.(e)
        }}
        className={cn(
          'flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-[color,border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive',
          autoResize && 'resize-none',
          className
        )}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
