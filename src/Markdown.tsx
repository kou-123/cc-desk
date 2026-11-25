import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Strip raw HTML tags from markdown source so we only render MD → HTML. */
function stripRawHtml(src: string) {
  return src.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => escapeHtml(tag))
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = marked.parse(stripRawHtml(text), { async: false }) as string
  return (
    <div
      className={`md ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
