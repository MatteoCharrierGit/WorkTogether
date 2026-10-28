import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

/** Montare una volta in alto nell'albero (App). */
const TooltipProvider = ({ delayDuration = 300, skipDelayDuration = 200, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
)

const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-tooltip max-w-xs overflow-hidden rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md',
        'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/**
 * Scorciatoia: <SimpleTooltip content="Testo"><button/></SimpleTooltip>.
 * Funziona anche senza TooltipProvider globale (ne crea uno locale).
 */
function SimpleTooltip({
  content,
  children,
  side,
  align,
  shortcut,
  disabled,
}: {
  content: React.ReactNode
  children: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  shortcut?: string
  disabled?: boolean
}) {
  const triggerRef = React.useRef<HTMLElement>(null)
  const [open, setOpen] = React.useState(false)
  // Radix apre il tooltip a ogni focus, anche programmatico (es. autofocus del primo bottone di
  // un dialog aperto col mouse). Si apre solo con hover o con focus da tastiera (:focus-visible).
  const onOpenChange = React.useCallback((next: boolean) => {
    const el = triggerRef.current
    if (next && el && !el.matches(':hover') && !el.matches(':focus-visible')) return
    setOpen(next)
  }, [])
  if (disabled || !content) return children
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger ref={triggerRef as React.Ref<HTMLButtonElement>} asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} align={align}>
          <span className="flex items-center gap-2">
            {content}
            {shortcut && <kbd className="font-mono text-2xs opacity-70">{shortcut}</kbd>}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, SimpleTooltip }
