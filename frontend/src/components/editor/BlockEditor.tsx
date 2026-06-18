import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Typography from '@tiptap/extension-typography'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import {
  Bold, Italic, List, ListOrdered, CheckSquare,
  Heading1, Heading2, Quote, Code, Minus
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BlockEditorProps {
  content?: string
  onChange?: (content: string) => void
  readOnly?: boolean
  placeholder?: string
  className?: string
}

export function BlockEditor({
  content,
  onChange,
  readOnly = false,
  placeholder = 'Scrivi qui il contenuto...',
  className,
}: BlockEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
    ],
    content: content ? JSON.parse(content) : '',
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange?.(JSON.stringify(editor.getJSON()))
    },
  })

  useEffect(() => {
    if (!editor) return
    const parsed = content ? JSON.parse(content) : ''
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(parsed)) {
      editor.commands.setContent(parsed)
    }
  }, [content])

  if (!editor) return null

  return (
    <div className={cn('flex flex-col', className)}>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b pb-2 mb-3">
          {[
            { icon: <Bold className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
            { icon: <Italic className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
            { icon: <Code className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleCode().run(), active: editor.isActive('code') },
            { icon: <Heading1 className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
            { icon: <Heading2 className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
            { icon: <List className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
            { icon: <ListOrdered className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
            { icon: <CheckSquare className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleTaskList().run(), active: editor.isActive('taskList') },
            { icon: <Quote className="h-3.5 w-3.5" />, action: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
            { icon: <Minus className="h-3.5 w-3.5" />, action: () => editor.chain().focus().setHorizontalRule().run(), active: false },
          ].map((item, i) => (
            <Button
              key={i}
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7', item.active && 'bg-accent')}
              onClick={item.action}
              type="button"
            >
              {item.icon}
            </Button>
          ))}
        </div>
      )}
      <EditorContent
        editor={editor}
        className={cn('prose prose-sm dark:prose-invert max-w-none flex-1', readOnly && 'cursor-default')}
      />
    </div>
  )
}
