import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

/** Input password con bottone mostra/nascondi (IconButton accessibile). */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    return (
      <div className="relative">
        <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
        <IconButton
          type="button"
          size="xs"
          label={visible ? 'Nascondi password' : 'Mostra password'}
          icon={visible ? <EyeOff /> : <Eye />}
          onClick={() => setVisible(v => !v)}
          className="absolute right-1 top-1/2 -translate-y-1/2"
          tabIndex={-1}
          noTooltip
        />
      </div>
    )
  }
)
PasswordInput.displayName = 'PasswordInput'
