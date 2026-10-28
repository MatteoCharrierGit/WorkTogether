import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Typography from '@tiptap/extension-typography'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  Bold, Italic, Strikethrough, List, ListOrdered, ListChecks,
  Heading1, Heading2, Heading3, Quote, Code, SquareCode, Minus, Undo2, Redo2,
} from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Separator } from '@/components/ui/separator'

interface BlockEditorProps {
  content?: string
  onChange?: (content: string) => void
  onFocus?: () => void
  onBlur?: () => void
  readOnly?: boolean
  placeholder?: string
  className?: string
  /** Classi aggiuntive per la toolbar (es. `sticky top-0`) */
  toolbarClassName?: string
}

/** JSON.parse tollerante: testo non-JSON diventa un paragrafo. */
function parseContent(content?: string): any {
  if (!content) return ''
  try {
    return JSON.parse(content)
  } catch {
    return {
      type: 'doc',
      content: content.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
    }
  }
}

/** Serializzazione con chiavi ordinate: il backend salva il body in jsonb, che riordina le chiavi. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter(k => obj[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Confronta due body (stringhe JSON dell'editor) ignorando l'ordine delle chiavi. */
export function sameBody(a?: string | null, b?: string | null): boolean {
  if ((a ?? '') === (b ?? '')) return true
  const norm = (s?: string | null) => {
    const p = parseContent(s ?? undefined)
    // Documento vuoto (nessun blocco o un solo paragrafo vuoto) == body assente.
    const c = p?.content
    if (!p || (Array.isArray(c) && (c.length === 0 || (c.length === 1 && c[0]?.type === 'paragraph' && !c[0]?.content?.length)))) return ''
    return stableStringify(p)
  }
  return norm(a) === norm(b)
}

export function BlockEditor({
  content,
  onChange,
  onFocus,
  onBlur,
  readOnly = false,
  placeholder = 'Scrivi qui il contenuto...',
  className,
  toolbarClassName,
}: BlockEditorProps) {
  // Callback sempre aggiornate senza ricreare l'editor.
  const cbRef = useRef({ onChange, onFocus, onBlur })
  cbRef.current = { onChange, onFocus, onBlur }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
    ],
    content: parseContent(content),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      cbRef.current.onChange?.(JSON.stringify(editor.getJSON()))
    },
    onFocus: () => cbRef.current.onFocus?.(),
    onBlur: () => cbRef.current.onBlur?.(),
  })

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  // Contenuto esterno (es. aggiornamento da un altro utente): si applica solo se diverso
  // nella sostanza, mantenendo la selezione dove possibile e senza emettere onChange.
  useEffect(() => {
    if (!editor) return
    const parsed = parseContent(content)
    if (stableStringify(editor.getJSON()) === stableStringify(parsed || { type: 'doc', content: [{ type: 'paragraph' }] })) return
    if (!content && editor.isEmpty) return
    const { from, to } = editor.state.selection
    editor.commands.setContent(parsed, false)
    const max = editor.state.doc.content.size
    try {
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
    } catch {
      /* selezione non ripristinabile: ignora */
    }
  }, [content, editor])

  if (!editor) return null

  const tools: ({ label: string; icon: React.ReactNode; action: () => void; active?: boolean; disabled?: boolean } | 'sep')[] = [
    { label: 'Annulla', icon: <Undo2 />, action: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    { label: 'Ripeti', icon: <Redo2 />, action: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },
    'sep',
    { label: 'Titolo 1', icon: <Heading1 />, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
    { label: 'Titolo 2', icon: <Heading2 />, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
    { label: 'Titolo 3', icon: <Heading3 />, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
    'sep',
    { label: 'Grassetto', icon: <Bold />, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { label: 'Corsivo', icon: <Italic />, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { label: 'Barrato', icon: <Strikethrough />, action: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike') },
    { label: 'Codice in linea', icon: <Code />, action: () => editor.chain().focus().toggleCode().run(), active: editor.isActive('code') },
    'sep',
    { label: 'Elenco puntato', icon: <List />, action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { label: 'Elenco numerato', icon: <ListOrdered />, action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    { label: 'Lista di controllo', icon: <ListChecks />, action: () => editor.chain().focus().toggleTaskList().run(), active: editor.isActive('taskList') },
    { label: 'Citazione', icon: <Quote />, action: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
    { label: 'Blocco di codice', icon: <SquareCode />, action: () => editor.chain().focus().toggleCodeBlock().run(), active: editor.isActive('codeBlock') },
    { label: 'Separatore', icon: <Minus />, action: () => editor.chain().focus().setHorizontalRule().run() },
  ]

  return (
    <div className={cn('flex flex-col', className)}>
      {!readOnly && (
        <div
          role="toolbar"
          aria-label="Formattazione"
          className={cn('flex flex-wrap items-center gap-0.5 border-b bg-background py-1.5 mb-3', toolbarClassName)}
        >
          {tools.map((t, i) =>
            t === 'sep' ? (
              <Separator key={i} orientation="vertical" className="mx-1 h-4" />
            ) : (
              <IconButton
                key={t.label}
                label={t.label}
                icon={t.icon}
                size="xs"
                type="button"
                disabled={t.disabled}
                aria-pressed={t.active ?? undefined}
                onMouseDown={e => e.preventDefault()}
                onClick={t.action}
                className={cn(t.active && 'bg-accent text-foreground')}
              />
            )
          )}
        </div>
      )}
      <EditorContent
        editor={editor}
        className={cn('prose prose-sm dark:prose-invert max-w-none flex-1', readOnly && 'cursor-default')}
      />
    </div>
  )
}
