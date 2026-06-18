// Renderer Markdown minimale e autonomo (niente dipendenze esterne).
// Copre: titoli, grassetto, corsivo, codice inline e a blocchi, liste,
// citazioni, righe orizzontali, link e paragrafi. Sufficiente per un'anteprima.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s: string): string {
  // link [testo](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer" class="underline text-primary">${t}</a>`)
  // grassetto **testo**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // corsivo *testo*
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // codice inline `code`
  s = s.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-[0.85em]">$1</code>')
  return s
}

export function markdownToHtml(md: string): string {
  const lines = escapeHtml(md ?? '').split('\n')
  let html = ''
  let inCode = false
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null } }
  const flushCode = () => {
    html += `<pre class="bg-muted p-3 rounded-lg overflow-x-auto text-sm my-2"><code>${codeBuf.join('\n')}</code></pre>`
    codeBuf = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim().startsWith('```')) {
      if (!inCode) { closeList(); inCode = true; codeBuf = [] }
      else { inCode = false; flushCode() }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }

    if (line.trim() === '') { closeList(); continue }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      const lvl = h[1].length
      const size = lvl === 1 ? 'text-xl' : lvl === 2 ? 'text-lg' : 'text-base'
      html += `<h${lvl} class="${size} font-semibold mt-3 mb-1">${inline(h[2])}</h${lvl}>`
      continue
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) { closeList(); html += '<hr class="my-3 border-border"/>'; continue }

    if (line.trim().startsWith('&gt; ')) {
      closeList()
      html += `<blockquote class="border-l-4 border-muted-foreground/40 pl-3 italic text-muted-foreground my-1">${inline(line.trim().slice(5))}</blockquote>`
      continue
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      if (listType !== 'ul') { closeList(); html += '<ul class="list-disc pl-5 my-1">'; listType = 'ul' }
      html += `<li>${inline(ul[1])}</li>`
      continue
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      if (listType !== 'ol') { closeList(); html += '<ol class="list-decimal pl-5 my-1">'; listType = 'ol' }
      html += `<li>${inline(ol[1])}</li>`
      continue
    }

    closeList()
    html += `<p class="my-1 leading-relaxed">${inline(line)}</p>`
  }

  closeList()
  if (inCode) flushCode()
  return html
}

export type FileKind = 'image' | 'pdf' | 'markdown' | 'text' | 'other'

const TEXT_EXTS = [
  'txt', 'js', 'ts', 'jsx', 'tsx', 'json', 'java', 'css', 'scss', 'less', 'html', 'htm',
  'xml', 'yml', 'yaml', 'py', 'sh', 'bash', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'sql',
  'csv', 'env', 'ini', 'toml', 'kt', 'rb', 'php', 'log', 'conf', 'gradle', 'properties',
]
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']

export function fileKind(filename: string, contentType?: string): FileKind {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  if (contentType?.startsWith('image/') || IMAGE_EXTS.includes(ext)) return 'image'
  if (contentType === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (TEXT_EXTS.includes(ext) || contentType?.startsWith('text/')) return 'text'
  return 'other'
}
