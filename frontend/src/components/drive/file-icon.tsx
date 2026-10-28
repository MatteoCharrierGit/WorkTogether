import {
  File, FileArchive, FileAudio, FileCode, FileImage, FileJson, FileSpreadsheet, FileText, FileType, FileVideo,
  Presentation, Folder, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileMeta { icon: LucideIcon; className: string; label: string }

const CODE = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'html', 'htm', 'css', 'scss', 'less', 'sh', 'bash', 'sql', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'env', 'gradle', 'properties', 'vue', 'svelte', 'dart', 'lua', 'r', 'scala']
const ARCHIVE = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'jar']
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'tif', 'tiff']
const TEXT = ['txt', 'md', 'markdown', 'rtf', 'doc', 'docx', 'odt', 'log', 'pdf']
const SHEET = ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers']
const SLIDES = ['ppt', 'pptx', 'odp', 'key']
const AUDIO = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']
const VIDEO = ['mp4', 'mov', 'webm', 'mkv', 'avi']
const FONT = ['ttf', 'otf', 'woff', 'woff2']

export function fileExt(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i > 0 ? filename.slice(i + 1).toLowerCase() : ''
}

/** Icona lucide + colore (solo token) per un file in base a estensione/MIME. */
export function fileMeta(filename: string, contentType?: string): FileMeta {
  const ext = fileExt(filename)
  if (ext === 'pdf' || contentType === 'application/pdf') return { icon: FileText, className: 'text-destructive', label: 'PDF' }
  if (ext === 'json') return { icon: FileJson, className: 'text-warning', label: 'JSON' }
  if (IMAGE.includes(ext) || contentType?.startsWith('image/')) return { icon: FileImage, className: 'text-success', label: 'Immagine' }
  if (CODE.includes(ext)) return { icon: FileCode, className: 'text-info', label: 'Codice' }
  if (ARCHIVE.includes(ext)) return { icon: FileArchive, className: 'text-warning', label: 'Archivio' }
  if (SHEET.includes(ext)) return { icon: FileSpreadsheet, className: 'text-success', label: 'Foglio di calcolo' }
  if (SLIDES.includes(ext)) return { icon: Presentation, className: 'text-warning', label: 'Presentazione' }
  if (AUDIO.includes(ext) || contentType?.startsWith('audio/')) return { icon: FileAudio, className: 'text-primary', label: 'Audio' }
  if (VIDEO.includes(ext) || contentType?.startsWith('video/')) return { icon: FileVideo, className: 'text-primary', label: 'Video' }
  if (FONT.includes(ext)) return { icon: FileType, className: 'text-muted-foreground', label: 'Font' }
  if (TEXT.includes(ext) || contentType?.startsWith('text/')) return { icon: FileText, className: 'text-muted-foreground', label: 'Documento' }
  return { icon: File, className: 'text-muted-foreground', label: 'File' }
}

export function FileIcon({ filename, contentType, className }: { filename: string; contentType?: string; className?: string }) {
  const m = fileMeta(filename, contentType)
  const Icon = m.icon
  return <Icon className={cn('h-4 w-4 shrink-0', m.className, className)} aria-hidden="true" />
}

export function FolderGlyph({ className }: { className?: string }) {
  return <Folder className={cn('h-4 w-4 shrink-0 fill-primary/15 text-primary', className)} aria-hidden="true" />
}
