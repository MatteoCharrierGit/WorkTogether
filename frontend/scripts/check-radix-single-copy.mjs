// Verifica che i moduli Radix con stato globale siano installati in UNA sola copia.
//
// Perché: @radix-ui/react-dismissable-layer tiene in una variabile di modulo lo stile
// `pointer-events` originale del <body> e lo ripristina alla chiusura dell'ultimo layer.
// Con due copie (es. una usata da Dialog/AlertDialog e una da DropdownMenu) ognuna ha il proprio
// stato: aprendo una conferma da una voce di menu ("⋯ → Elimina") la copia del dialog memorizza
// come "originale" il `pointer-events: none` messo dal menu e lo rimette alla chiusura. Il body
// resta `pointer-events: none` e la pagina non risponde più ai click finché non si ricarica.
// Lo stesso vale per focus-scope (pila delle trappole di focus) e focus-guards (contatore).
//
// Se il controllo fallisce: aggiornare insieme tutti i pacchetti @radix-ui alla stessa "ondata"
// di versioni (npm install @radix-ui/react-…@latest …) e poi `npm dedupe`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STATEFUL = [
  '@radix-ui/react-dismissable-layer',
  '@radix-ui/react-focus-scope',
  '@radix-ui/react-focus-guards',
  'react-remove-scroll',
  'aria-hidden',
]

/** Ritorna { nome: [percorsi] } per i pacchetti di STATEFUL presenti in più copie nel lockfile. */
export function findDuplicates(lock) {
  const found = {}
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    for (const name of STATEFUL) {
      if (path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)) {
        ;(found[name] ??= []).push(`${path}@${info.version}`)
      }
    }
  }
  return Object.fromEntries(Object.entries(found).filter(([, paths]) => paths.length > 1))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lockPath = new URL('../package-lock.json', import.meta.url)
  const dups = findDuplicates(JSON.parse(readFileSync(lockPath, 'utf8')))
  const names = Object.keys(dups)
  if (names.length) {
    console.error('Moduli Radix con stato globale installati in più copie (la pagina può restare bloccata dopo un dialog):')
    for (const n of names) console.error(`  ${n}\n    ${dups[n].join('\n    ')}`)
    console.error('Aggiorna insieme i pacchetti @radix-ui e lancia `npm dedupe` (vedi scripts/check-radix-single-copy.mjs).')
    process.exit(1)
  }
  console.log('Radix: una sola copia dei moduli con stato globale.')
}
