import type { Extension } from '@codemirror/state'

// Nessun import statico dei pacchetti @codemirror/lang-*: ogni linguaggio è caricato on-demand
// (import dinamico → chunk separato) solo quando si apre un file di quel tipo.

export type LangId =
  | 'plaintext' | 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'python'
  | 'java' | 'html' | 'css' | 'json' | 'markdown' | 'xml' | 'sql' | 'rust'
  | 'cpp' | 'go' | 'php' | 'yaml' | 'shell' | 'ruby' | 'toml' | 'properties'

// Elenco ordinato per il dropdown del selettore linguaggio.
export const LANGUAGES: { id: LangId; label: string }[] = [
  { id: 'plaintext', label: 'Testo semplice' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'jsx', label: 'JavaScript (JSX)' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'tsx', label: 'TypeScript (TSX)' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'xml', label: 'XML' },
  { id: 'sql', label: 'SQL' },
  { id: 'rust', label: 'Rust' },
  { id: 'cpp', label: 'C / C++' },
  { id: 'go', label: 'Go' },
  { id: 'php', label: 'PHP' },
  { id: 'yaml', label: 'YAML' },
  { id: 'shell', label: 'Shell' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'toml', label: 'TOML' },
  { id: 'properties', label: 'INI / Properties' },
]

export const LANG_LABELS: Record<LangId, string> = Object.fromEntries(
  LANGUAGES.map(l => [l.id, l.label])
) as Record<LangId, string>

// Modalità "legacy" (stream parser) avvolte in StreamLanguage.
async function legacy(load: () => Promise<any>, key: string): Promise<Extension> {
  const [{ StreamLanguage }, mod] = await Promise.all([import('@codemirror/language'), load()])
  return StreamLanguage.define(mod[key])
}

const loaders: Partial<Record<LangId, () => Promise<Extension>>> = {
  javascript: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })),
  typescript: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true })),
  python: () => import('@codemirror/lang-python').then(m => m.python()),
  java: () => import('@codemirror/lang-java').then(m => m.java()),
  html: () => import('@codemirror/lang-html').then(m => m.html()),
  css: () => import('@codemirror/lang-css').then(m => m.css()),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  markdown: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  xml: () => import('@codemirror/lang-xml').then(m => m.xml()),
  sql: () => import('@codemirror/lang-sql').then(m => m.sql()),
  rust: () => import('@codemirror/lang-rust').then(m => m.rust()),
  cpp: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  go: () => import('@codemirror/lang-go').then(m => m.go()),
  php: () => import('@codemirror/lang-php').then(m => m.php()),
  yaml: () => legacy(() => import('@codemirror/legacy-modes/mode/yaml'), 'yaml'),
  shell: () => legacy(() => import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  ruby: () => legacy(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby'),
  toml: () => legacy(() => import('@codemirror/legacy-modes/mode/toml'), 'toml'),
  properties: () => legacy(() => import('@codemirror/legacy-modes/mode/properties'), 'properties'),
}

// Le estensioni sono riusabili tra editor: una sola istanza per linguaggio.
const cache = new Map<LangId, Promise<Extension | null>>()

/**
 * Carica (asincrono, con cache) l'estensione CodeMirror per il syntax highlighting del
 * linguaggio. `null` per testo semplice o se il caricamento fallisce (resta testo semplice).
 */
export function loadLangExtension(id: LangId): Promise<Extension | null> {
  const load = loaders[id]
  if (!load) return Promise.resolve(null)
  let p = cache.get(id)
  if (!p) {
    p = load().catch(() => { cache.delete(id); return null })
    cache.set(id, p)
  }
  return p
}

// Rileva il linguaggio dall'estensione del file (valore iniziale del selettore).
export function detectLang(filename: string): LangId {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return 'javascript'
    case 'jsx': return 'jsx'
    case 'ts': return 'typescript'
    case 'tsx': return 'tsx'
    case 'py': return 'python'
    case 'java': return 'java'
    case 'html': case 'htm': return 'html'
    case 'css': case 'scss': case 'less': return 'css'
    case 'json': return 'json'
    case 'md': case 'markdown': return 'markdown'
    case 'xml': return 'xml'
    case 'sql': return 'sql'
    case 'rs': return 'rust'
    case 'c': case 'cpp': case 'cc': case 'h': case 'hpp': return 'cpp'
    case 'go': return 'go'
    case 'php': return 'php'
    case 'yml': case 'yaml': return 'yaml'
    case 'sh': case 'bash': return 'shell'
    case 'rb': return 'ruby'
    case 'toml': return 'toml'
    case 'ini': case 'conf': case 'env': case 'gradle': case 'properties': return 'properties'
    default: return 'plaintext'
  }
}
