import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

type ModuleInfoGetter = (id: string) => { isEntry: boolean; importers: readonly string[] } | null

// true se il modulo è raggiungibile dall'entry tramite soli import statici (cioè finisce
// comunque nel caricamento iniziale). Serve a non trascinare nel chunk `ui` i componenti Radix
// usati solo da pagine lazy (tabs, progress…), che resterebbero altrimenti scaricati subito.
const staticReach = new Map<string, boolean>()
function isInInitialGraph(id: string, getModuleInfo: ModuleInfoGetter): boolean {
  const cached = staticReach.get(id)
  if (cached !== undefined) return cached
  // Visita in ampiezza degli importer statici (set locale: niente risultati parziali in cache).
  const seen = new Set([id])
  const queue = [id]
  let result = false
  while (queue.length && !result) {
    const info = getModuleInfo(queue.shift()!)
    if (!info) continue
    if (info.isEntry) { result = true; break }
    for (const imp of info.importers) {
      if (staticReach.get(imp)) { result = true; break }
      if (!seen.has(imp)) { seen.add(imp); queue.push(imp) }
    }
  }
  staticReach.set(id, result)
  return result
}

export default defineConfig({
  plugins: [react()],
  // sockjs-client (usato da @stomp/stompjs) referenzia `global`, che nel browser
  // non esiste: senza questo Vite lancia "global is not defined" e la pagina resta bianca.
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // L'unico chunk oltre 500 kB è livekit-client (~530 kB), caricato solo al join vocale.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Vendor stabili in chunk separati: cambiano di rado, quindi restano in cache tra i
        // deploy dell'app. Le librerie pesanti usate solo da alcune pagine (codemirror, tiptap,
        // livekit, dnd-kit…) NON sono elencate: devono restare nei chunk lazy che le importano.
        manualChunks(id, { getModuleInfo }) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|@remix-run[\\/]router|scheduler)[\\/]/.test(id)) return 'react'
          if (/[\\/]node_modules[\\/](@tanstack[\\/](react-query|query-core)|axios|zustand)[\\/]/.test(id)) return 'data'
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id) && isInInitialGraph(id, getModuleInfo)) return 'ui'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
    },
  },
})
