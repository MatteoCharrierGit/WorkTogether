import * as React from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn, getErrorMessage } from '@/lib/utils'
import { Callout } from './callout'
import { EmptyState, type EmptyStateProps } from './empty-state'

/** Sottoinsieme di UseQueryResult che serve a QueryState. */
export interface QueryLike<T> {
  data?: T
  isLoading?: boolean
  isPending?: boolean
  isError?: boolean
  error?: unknown
  refetch?: () => unknown
  isFetching?: boolean
}

export type SkeletonKind = 'list' | 'cards' | 'table' | 'text' | 'spinner'

export interface QueryStateProps<T> {
  /** Passa direttamente il risultato di useQuery... */
  query?: QueryLike<T>
  /** ...oppure i singoli flag */
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  onRetry?: () => void
  /** Default: data è un array vuoto (o null/undefined dopo il caricamento) */
  isEmpty?: boolean | ((data: T) => boolean)
  /** Props dell'EmptyState o nodo personalizzato */
  empty?: EmptyStateProps | React.ReactNode
  /** Nodo di caricamento personalizzato (vince su `skeleton`) */
  loading?: React.ReactNode
  skeleton?: SkeletonKind
  /** Numero di righe/card dello skeleton */
  rows?: number
  errorTitle?: string
  className?: string
  children: React.ReactNode | ((data: T) => React.ReactNode)
}

export function LoadingSkeleton({ kind = 'list', rows = 4, className }: { kind?: SkeletonKind; rows?: number; className?: string }) {
  if (kind === 'spinner') {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <Spinner size="md" />
      </div>
    )
  }
  if (kind === 'cards') {
    return (
      <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)} aria-busy="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    )
  }
  if (kind === 'text') {
    return (
      <div className={cn('space-y-2', className)} aria-busy="true">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3.5', i === rows - 1 ? 'w-3/5' : 'w-full')} />
        ))}
      </div>
    )
  }
  // list / table
  return (
    <div className={cn('divide-y rounded-lg border', className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          {kind === 'list' && <Skeleton className="h-7 w-7 rounded-full" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            {kind === 'list' && <Skeleton className="h-3 w-1/2" />}
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

function isEmptyStateProps(v: unknown): v is EmptyStateProps {
  return !!v && typeof v === 'object' && !React.isValidElement(v) && 'title' in (v as object)
}

/**
 * Gestisce in un punto solo caricamento → errore (con Riprova) → vuoto → contenuto.
 *
 *   <QueryState query={q} empty={{ title: 'Nessun file' }}>{files => <List files={files}/>}</QueryState>
 */
export function QueryState<T>({
  query,
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  empty,
  loading,
  skeleton = 'list',
  rows,
  errorTitle = 'Impossibile caricare i dati',
  className,
  children,
}: QueryStateProps<T>) {
  const loadingFlag = isLoading ?? query?.isLoading ?? false
  const errorFlag = isError ?? query?.isError ?? false
  const err = error ?? query?.error
  const retry = onRetry ?? (query?.refetch ? () => void query.refetch!() : undefined)
  const data = query?.data as T

  if (loadingFlag) {
    return <div className={className}>{loading ?? <LoadingSkeleton kind={skeleton} rows={rows} />}</div>
  }

  // Un refetch fallito con dati già in cache (react-query v5: isError + data) non nasconde il
  // contenuto: l'errore vince solo quando non ci sono dati da mostrare.
  if (errorFlag && data == null) {
    return (
      <Callout
        variant="destructive"
        title={errorTitle}
        className={className}
        action={
          retry && (
            <Button size="sm" variant="outline" onClick={retry} loading={query?.isFetching}>
              <RotateCw className="h-3.5 w-3.5" /> Riprova
            </Button>
          )
        }
      >
        {getErrorMessage(err)}
      </Callout>
    )
  }

  const emptyFlag =
    typeof isEmpty === 'function'
      ? isEmpty(data)
      : isEmpty ?? (query ? data == null || (Array.isArray(data) && data.length === 0) : false)

  if (emptyFlag && empty !== undefined) {
    return (
      <div className={className}>
        {isEmptyStateProps(empty) ? <EmptyState {...empty} /> : (empty as React.ReactNode)}
      </div>
    )
  }

  return <>{typeof children === 'function' ? (children as (d: T) => React.ReactNode)(data) : children}</>
}
