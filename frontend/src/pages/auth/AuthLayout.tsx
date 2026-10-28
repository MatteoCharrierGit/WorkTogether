import * as React from 'react'
import { Bot, KanbanSquare, MessagesSquare } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/shared'
import { cn } from '@/lib/utils'

const FEATURES = [
  { icon: KanbanSquare, title: 'Kanban, roadmap e sprint', text: 'Epiche, storie e task sempre allineati.' },
  { icon: MessagesSquare, title: 'Chat e stanze vocali', text: 'Discussioni accanto al lavoro, non altrove.' },
  { icon: Bot, title: 'Drive e agente AI', text: 'File condivisi e un assistente che conosce il progetto.' },
]

function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src="/icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg shadow-xs" />
      <span className="text-heading font-semibold tracking-tight">WorkTogether</span>
    </div>
  )
}

/**
 * Layout delle pagine pubbliche (login, onboarding, reset, inviti).
 * Mobile: colonna centrata con logo. Da lg: pannello del brand a sinistra + form a destra.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh bg-background">
      {/* Pannello brand (desktop) */}
      <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden border-r bg-surface-2 p-10 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl"
        />
        <Brand className="relative" />
        <div className="relative space-y-8">
          <div className="space-y-3">
            <h2 className="text-display font-semibold tracking-tight">
              Il lavoro del team,<br />in un unico posto.
            </h2>
            <p className="max-w-sm text-body text-muted-foreground">
              Progetti, conversazioni e documenti condivisi: WorkTogether tiene tutto collegato.
            </p>
          </div>
          <ul className="space-y-4">
            {FEATURES.map(f => (
              <li key={f.title} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-card text-primary shadow-xs">
                  <f.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-caption text-muted-foreground">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-caption text-muted-foreground">© {new Date().getFullYear()} WorkTogether</p>
      </aside>

      {/* Colonna del form */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <Brand className="mb-8 justify-center lg:hidden" />
          <div className="mb-6 space-y-1.5 text-center lg:text-left">
            <h1 className="text-title font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {children}
          {footer && <div className="mt-6 text-center text-caption text-muted-foreground lg:text-left">{footer}</div>}
        </div>
      </main>
    </div>
  )
}

/** Campo di form: label + controllo + aiuto/errore inline (con aria collegati). */
export function AuthField({
  id,
  label,
  hint,
  error,
  aside,
  children,
}: {
  id: string
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string | false | null
  /** Elemento a destra della label (es. link "Password dimenticata?") */
  aside?: React.ReactNode
  children: React.ReactElement
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {React.cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-destructive">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/** Errore generale del form (es. credenziali errate). */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <Callout variant="destructive">{children}</Callout>
}
