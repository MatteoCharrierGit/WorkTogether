# Design system WorkTogether

Estetica sobria e densa (stile Linear/Notion): grigi neutri, **un solo colore d'accento**, bordi sottili, ombre morbide.

## Temi e accento

- Due temi: **chiaro** e **scuro** (classe `.dark` su `<html>`), più **Sistema** che segue `prefers-color-scheme`.
- Accento: attributo `data-accent` su `<html>` (`indigo` default, `blue`, `violet`, `green`, `amber`, `rose`): cambia `--primary` e `--ring`.
- `useTheme()` → `{ theme, resolvedTheme, setTheme, accent, setAccent }` (`components/layout/ThemeProvider.tsx`).
  I vecchi valori salvati (`bianco`, `crema`, … / `grigio`, `notte`, …) vengono migrati automaticamente.

## Token (classi Tailwind)

| Gruppo | Classi |
| --- | --- |
| Superfici | `bg-background`, `bg-card`, `bg-surface-2` (sfondo secondario), `bg-elevated` (dialog/sheet), `bg-popover`, `bg-muted`, `bg-accent` (hover neutro), `bg-sidebar`, `bg-sidebar-accent` |
| Testo | `text-foreground`, `text-muted-foreground`, `text-primary` |
| Bordi | `border` (= `border-border`), `border-border-strong`, `border-input` |
| Accento | `bg-primary`, `text-primary-foreground`, `bg-primary/10`, `ring-ring` |
| Semantici | `success`, `warning`, `info`, `destructive` → `bg-success`, `text-success`, `bg-success-subtle`, `text-success-foreground` (idem per gli altri) |
| Ombre | `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg` |
| Raggi | `rounded-md` (8px, controlli), `rounded-lg` (10px, card), `rounded-xl` (12px, dialog) |
| z-index | `z-sticky`, `z-header`, `z-overlay`, `z-modal`, `z-popover`, `z-toast`, `z-tooltip` |
| Tipografia | `text-display`, `text-title`, `text-heading`, `text-body`, `text-caption`, `text-2xs`; `font-sans` (Inter Variable), `font-mono` (JetBrains Mono) |
| Focus | utility `focus-ring` (anello 2px + offset) |
| Colori arbitrari | `tintVars(hex)` + classe `tinted` (sfondo tenue + testo leggibile, es. tag) |

Markdown/editor: `prose prose-sm dark:prose-invert max-w-none` usa già i token.

## Primitive (`components/ui`)

`Button` (variant `default|secondary|outline|ghost|destructive|link`, size `default|sm|xs|lg|icon|icon-sm|icon-xs`, prop `loading`),
`IconButton` (`label` obbligatoria → aria-label + tooltip), `Input`, `Textarea` (`autoResize`), `Select`, `Checkbox`, `Switch`, `Label`,
`Card*`, `Dialog*` (+ `DialogFooter`, `DialogDescription`), `AlertDialog*`, `Sheet*` (drawer laterale/basso), `DropdownMenu*`
(item `destructive`), `Popover`, `Tooltip*`/`SimpleTooltip`, `Tabs` (`TabsList variant="pill|underline"`), `Badge`
(`default|primary|secondary|outline|muted|success|warning|info|destructive|destructive-solid`), `Avatar`, `Progress`, `Separator`,
`Skeleton`/`SkeletonText`, `Spinner`, `Kbd`, `ScrollArea`, `Command*` (+ `CommandDialog`), `toast(title, 'default'|'success'|'info'|'destructive')`.

## Componenti condivisi (`components/shared`, import da `@/components/shared`)

- `PageHeader` — `title`, `description`, `icon`, `actions`, `breadcrumb`, `children`.
- `EmptyState` — `icon`, `title`, `description`, `action`, `size`, `bordered`.
- `QueryState` — `query` (risultato di `useQuery`) oppure `isLoading/isError/error/onRetry`; `empty`, `isEmpty`, `skeleton`, `loading`; children o `(data) => …`.
- `Callout` — `variant` `info|success|warning|destructive|neutral`, `title`, `action`.
- `ConfirmDialog` (controllato) e `useConfirm()` (serve `ConfirmProvider` in App):
  `if (!(await confirm({ title, description, confirmLabel: 'Elimina', destructive: true }))) return`
- `TagChip` / `TagList`, `TypeIcon`, `StatusIcon`, `StatusBadge`, `BlockedBadge`, `TYPE_META`, `STATUS_META`.
- `UserAvatar` (`size`, `presence`), `AvatarStack`.
- `TaskCard` — solo presentazione (`title`, `href`, `status`, `tags`, `assignees`, `dueDate`, `blocked`, `actions`, `footer`, `dragging`).

## Regole per chi scrive le pagine

1. **Solo token.** Niente palette grezza (`bg-green-500`, `text-amber-600`, `border-slate-300`, hex inline): usare `success/warning/info/destructive/primary/muted`.
2. **Ogni bottone solo-icona è un `IconButton` con `label`** (in italiano). Mai `<button title=…>` con sola icona.
3. **Ogni query passa da `QueryState`** oppure gestisce esplicitamente caricamento, errore (con Riprova) e vuoto.
4. **Mobile-first**: layout base per 360px, poi `sm:`/`md:`/`lg:`; azioni che vanno a capo, niente scroll orizzontale della pagina.
5. **Niente dimensioni arbitrarie** `text-[Npx]`: usare la scala (`text-2xs`, `text-caption`, `text-body`, `text-heading`, `text-title`, `text-display`, o `text-xs/sm/base`).
6. Niente `window.confirm`: usare `useConfirm()`. Niente emoji come icone: usare `lucide-react` (`TypeIcon` per i tipi).
7. Icone lucide `h-4 w-4` nei controlli, `h-3.5 w-3.5` nei controlli piccoli; testo UI in italiano.
