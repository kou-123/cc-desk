/** Attachments Claude Code accepts via stream-json content blocks. */

export type AttachmentKind = 'image' | 'document' | 'file'

export type ChatAttachment = {
  id: string
  name: string
  mime: string
  size: number
  kind: AttachmentKind
  /** base64 without data: prefix — sent to the API */
  data: string
  /** local object URL for image preview (revoked on remove) */
  previewUrl?: string
}

const IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
])

const MAX_BYTES = 20 * 1024 * 1024

export function classifyAttachment(mime: string, name: string): AttachmentKind {
  const m = (mime || '').toLowerCase().split(';')[0].trim()
  const ext = name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    : ''
  if (IMAGE_MIME.has(m) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    return 'image'
  }
  if (m === 'application/pdf' || ext === 'pdf') return 'document'
  return 'file'
}

export function normalizeMime(mime: string, name: string, kind: AttachmentKind) {
  const m = (mime || '').toLowerCase().split(';')[0].trim()
  if (kind === 'image') {
    if (m === 'image/jpg') return 'image/jpeg'
    if (IMAGE_MIME.has(m)) return m === 'image/jpg' ? 'image/jpeg' : m
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    if (ext === 'gif') return 'image/gif'
    if (ext === 'webp') return 'image/webp'
    return 'image/png'
  }
  if (kind === 'document') return 'application/pdf'
  return m || 'application/octet-stream'
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  if (file.size <= 0) throw new Error(`空文件：${file.name}`)
  if (file.size > MAX_BYTES) {
    throw new Error(`文件过大（上限 20MB）：${file.name}`)
  }
  const kind = classifyAttachment(file.type, file.name)
  const mime = normalizeMime(file.type, file.name, kind)
  const dataUrl = await readAsDataUrl(file)
  const comma = dataUrl.indexOf(',')
  const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  if (!data) throw new Error(`无法读取：${file.name}`)
  const previewUrl =
    kind === 'image' ? URL.createObjectURL(file) : undefined
  return {
    id: crypto.randomUUID(),
    name: file.name || 'attachment',
    mime,
    size: file.size,
    kind,
    data,
    previewUrl,
  }
}

export function revokeAttachment(att: ChatAttachment) {
  if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Accept attribute for the hidden file input.
 * Claude Code accepts images/PDF as content blocks and other files via disk staging —
 * so we do not restrict the picker; the server classifies each file.
 */
export const ATTACH_ACCEPT = '*/*'
