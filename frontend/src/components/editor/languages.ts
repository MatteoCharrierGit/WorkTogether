import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { sql } from '@codemirror/lang-sql'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { php } from '@codemirror/lang-php'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'

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

// Restituisce l'estensione CodeMirror per il syntax highlighting del linguaggio.
export function langExtension(id: LangId): Extension | null {
  switch (id) {
    case 'javascript': return javascript()
    case 'jsx': return javascript({ jsx: true })
    case 'typescript': return javascript({ typescript: true })
    case 'tsx': return javascript({ jsx: true, typescript: true })
    case 'python': return python()
    case 'java': return java()
    case 'html': return html()
    case 'css': return css()
    case 'json': return json()
    case 'markdown': return markdown()
    case 'xml': return xml()
    case 'sql': return sql()
    case 'rust': return rust()
    case 'cpp': return cpp()
    case 'go': return go()
    case 'php': return php()
    case 'yaml': return StreamLanguage.define(yaml)
    case 'shell': return StreamLanguage.define(shell)
    case 'ruby': return StreamLanguage.define(ruby)
    case 'toml': return StreamLanguage.define(toml)
    case 'properties': return StreamLanguage.define(properties)
    default: return null
  }
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
