// Renderer Markdown minimale e autonomo (niente dipendenze esterne).
// Copre: titoli, grassetto, corsivo, codice inline e a blocchi, liste,
// citazioni, righe orizzontali, link e paragrafi. Sufficiente per un'anteprima.
// L'HTML prodotto è "nudo": lo stile viene da `prose prose-sm dark:prose-invert` sul contenitore.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Solo link http(s), mailto o relativi: niente `javascript:` & co. */
function safeHref(u: string): string | null {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(u) ? u : null
}

function inline(s: string): string {
  // link [testo](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, t, u) => {
      const href = safeHref(u)
      return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>` : m
    })
  // grassetto **testo**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // corsivo *testo*
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // codice inline `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
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
    html += `<pre><code>${codeBuf.join('\n')}</code></pre>`
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
      html += `<h${lvl}>${inline(h[2])}</h${lvl}>`
      continue
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) { closeList(); html += '<hr/>'; continue }

    if (line.trim().startsWith('&gt; ')) {
      closeList()
      html += `<blockquote>${inline(line.trim().slice(5))}</blockquote>`
      continue
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul' }
      const task = ul[1].match(/^\[( |x|X)\]\s+(.*)$/)
      html += task
        ? `<li class="task-list-item"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'} aria-label="${task[1] === ' ' ? 'Da fare' : 'Fatto'}"> ${inline(task[2])}</li>`
        : `<li>${inline(ul[1])}</li>`
      continue
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol' }
      html += `<li>${inline(ol[1])}</li>`
      continue
    }

    closeList()
    html += `<p>${inline(line)}</p>`
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
