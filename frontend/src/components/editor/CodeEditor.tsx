import { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { langExtension, LANG_LABELS, LangId } from './languages'
import { useIsDark } from '@/lib/useIsDark'
import { cn } from '@/lib/utils'

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language: LangId
  readOnly?: boolean
  wrap?: boolean
  className?: string
}

// Editor di codice stile VSCode basato su CodeMirror 6: syntax highlighting,
// numeri di riga, code folding, parentesi abbinate, ricerca (Ctrl+F),
// autocompletamento, tema chiaro/scuro e barra di stato con posizione cursore.
export function CodeEditor({ value, onChange, language, readOnly = false, wrap = false, className }: CodeEditorProps) {
  const dark = useIsDark()
  const [pos, setPos] = useState({ line: 1, col: 1 })

  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [EditorView.theme({ '&': { height: '100%' } })]
    const lang = langExtension(language)
    if (lang) exts.push(lang)
    if (wrap) exts.push(EditorView.lineWrapping)
    return exts
  }, [language, wrap])

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={value}
          onChange={onChange}
          editable={!readOnly}
          readOnly={readOnly}
          theme={dark ? 'dark' : 'light'}
          extensions={extensions}
          height="100%"
          className="h-full text-[13px]"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: !readOnly,
            highlightActiveLineGutter: !readOnly,
            autocompletion: true,
            bracketMatching: true,
            closeBrackets: !readOnly,
            indentOnInput: !readOnly,
            highlightSelectionMatches: true,
          }}
          onUpdate={u => {
            const head = u.state.selection.main.head
            const line = u.state.doc.lineAt(head)
            const next = { line: line.number, col: head - line.from + 1 }
            setPos(prev => (prev.line === next.line && prev.col === next.col ? prev : next))
          }}
        />
      </div>
      <div className="flex items-center justify-between px-3 py-1 border-t bg-muted/30 text-[11px] text-muted-foreground shrink-0">
        <span>{LANG_LABELS[language]}{readOnly && ' · sola lettura'}</span>
        <span>Ln {pos.line}, Col {pos.col} · {value.length} caratteri</span>
      </div>
    </div>
  )
}
