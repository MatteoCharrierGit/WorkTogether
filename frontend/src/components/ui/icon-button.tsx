import * as React from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children'> {
  /** Obbligatorio: diventa aria-label e testo del tooltip */
  label: string
  icon: React.ReactNode
  size?: 'default' | 'sm' | 'xs'
  /** Disattiva il tooltip (aria-label resta) */
  noTooltip?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  shortcut?: string
}

const SIZE = { default: 'icon', sm: 'icon-sm', xs: 'icon-xs' } as const

/** Bottone solo-icona accessibile: aria-label + tooltip sempre presenti. */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, size = 'sm', variant = 'ghost', noTooltip, tooltipSide, shortcut, className, ...props }, ref) => {
    const btn = (
      <Button
        ref={ref}
        variant={variant}
        size={SIZE[size]}
        aria-label={label}
        className={cn(
          size === 'xs' ? '[&_svg]:h-3.5 [&_svg]:w-3.5' : '[&_svg]:h-4 [&_svg]:w-4',
          variant === 'ghost' && 'text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
          className
        )}
        {...props}
      >
        {icon}
      </Button>
    )
    return (
      <SimpleTooltip content={label} side={tooltipSide} shortcut={shortcut} disabled={noTooltip}>
        {btn}
      </SimpleTooltip>
    )
  }
)
IconButton.displayName = 'IconButton'

export { IconButton }
