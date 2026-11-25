import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Markdown } from './Markdown'
import { copyImageFromUrl } from './native'

export type ChatTool = {
  name: string
  summary: string
  result?: string
}

export type ChatBlock = {
  kind: 'user' | 'assistant' | 'work'
  role: string
  text?: string
  images?: string[]
  files?: { name: string; kind: string }[]
  label?: string
  thinking?: string[]
  tools?: ChatTool[]
  timestamp?: string | number | null
  model?: string | null
  durationMs?: number | null
  thinkingMs?: number | null
}

type Turn =
  | { type: 'user'; block: ChatBlock }
  | { type: 'assistant'; steps: ChatBlock[] }

function formatClock(ts: string | number | null | undefined) {
  if (ts == null) return null
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDur(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

/** Group flat blocks into Codex-like turns (user → assistant staircase). */
function groupTurns(messages: ChatBlock[]): Turn[] {
  const turns: Turn[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    if (m.kind === 'user') {
      turns.push({ type: 'user', block: m })
      i += 1
      continue
    }
    const steps: ChatBlock[] = []
    while (i < messages.length && messages[i].kind !== 'user') {
      steps.push(messages[i])
      i += 1
    }
    if (steps.length) turns.push({ type: 'assistant', steps })
  }
  return turns
}

function turnMeta(steps: ChatBlock[]) {
  const last = [...steps].reverse().find((s) => s.kind === 'assistant') || steps[steps.length - 1]
  const model = steps.map((s) => s.model).find(Boolean) || null
  const clock = formatClock(last?.timestamp)
  let durationMs: number | null = null
  for (const s of steps) {
    if (s.kind === 'assistant' && s.durationMs && s.durationMs > (durationMs || 0)) {
      durationMs = s.durationMs
    }
  }
  if (durationMs == null) {
    let think = 0
    for (const s of steps) {
      if (s.thinkingMs) think += s.thinkingMs
    }
    if (think > 0) durationMs = think
  }
  const bits: string[] = []
  if (clock) bits.push(clock)
  if (model) bits.push(model)
  const dur = formatDur(durationMs)
  if (dur) bits.push(`Worked ${dur}`)
  return bits.join(' · ')
}

type Props = {
  messages: ChatBlock[]
  onToast?: (msg: string, error?: boolean) => void
}

type ImgMenu = { x: number; y: number; src: string }

async function copyImageToClipboard(src: string) {
  // Prefer Electron native clipboard when available (more reliable for images).
  try {
    await copyImageFromUrl(src)
    return
  } catch {
    /* fall through to web clipboard */
  }
  const res = await fetch(src)
  if (!res.ok) throw new Error('无法读取图片')
  let blob = await res.blob()
  if (blob.type && blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法转换图片')
    ctx.drawImage(bmp, 0, 0)
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('转 PNG 失败'))),
        'image/png',
      )
    })
  }
  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error('当前环境不支持复制图片')
  }
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || 'image/png']: blob }),
  ])
}

function ImageLightbox({
  src,
  onClose,
  onCopy,
}: {
  src: string
  onClose: () => void
  onCopy: (src: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="img-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <div className="img-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn primary" onClick={() => onCopy(src)}>
          复制图片
        </button>
        <button type="button" className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
      <img
        src={src}
        alt="预览"
        className="img-lightbox-full"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          onCopy(src)
        }}
      />
    </div>
  )
}

function WorkStep({ m }: { m: ChatBlock }) {
  const toolCount = m.tools?.length || 0
  const thinkCount = m.thinking?.length || 0
  const dur = formatDur(m.thinkingMs || m.durationMs)
  return (
    <details className="step-fold">
      <summary>
        <span className="work-arrow">▸</span>
        <span className="work-label">{m.label || '思考与工具'}</span>
        <span className="work-meta">
          {thinkCount ? `${thinkCount} 段思考` : ''}
          {thinkCount && toolCount ? ' · ' : ''}
          {toolCount ? `${toolCount} 次工具` : ''}
          {dur ? ` · ${dur}` : ''}
        </span>
      </summary>
      <div className="work-body">
        {(m.thinking || []).map((t, ti) => (
          <div key={`t-${ti}`} className="work-thinking">
            <div className="work-sub">Thinking</div>
            <pre>{t}</pre>
          </div>
        ))}
        {(m.tools || []).map((tool, ti) => (
          <div key={`tool-${ti}`} className="work-tool">
            <div className="work-sub">
              <span className="tool-name">
                {tool.name === 'result' ? 'Tool result' : tool.name}
              </span>
              {tool.summary ? (
                <span className="tool-sum">{tool.summary}</span>
              ) : null}
            </div>
            {tool.result ? <pre className="tool-result">{tool.result}</pre> : null}
          </div>
        ))}
      </div>
    </details>
  )
}

function ImageThumbs({
  images,
  onPreview,
  onMenu,
}: {
  images: string[]
  onPreview: (src: string) => void
  onMenu: (e: ReactMouseEvent, src: string) => void
}) {
  return (
    <div className="msg-images">
      {images.map((src, ii) => (
        <button
          key={`${src}-${ii}`}
          type="button"
          className="msg-thumb"
          title="点击放大 · 右键复制"
          onClick={() => onPreview(src)}
          onContextMenu={(e) => onMenu(e, src)}
        >
          <img
            src={src}
            alt={`图片 ${ii + 1}`}
            className="msg-thumb-img"
            loading="lazy"
            draggable={false}
          />
          <span className="msg-thumb-hint">点击放大</span>
        </button>
      ))}
    </div>
  )
}

export function MessageList({ messages, onToast }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [menu, setMenu] = useState<ImgMenu | null>(null)
  const turns = useMemo(() => groupTurns(messages), [messages])

  const copyImage = useCallback(
    async (src: string) => {
      setMenu(null)
      try {
        await copyImageToClipboard(src)
        onToast?.('已复制图片')
      } catch (e) {
        onToast?.(e instanceof Error ? e.message : String(e), true)
      }
    },
    [onToast],
  )

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const openMenu = (e: ReactMouseEvent, src: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, src })
  }

  if (!messages.length) {
    return <div className="turn-empty">暂无可读消息预览</div>
  }

  return (
    <div className="messages" onClick={() => setMenu(null)}>
      {turns.map((turn, ti) => {
        if (turn.type === 'user') {
          const m = turn.block
          const clock = formatClock(m.timestamp)
          return (
            <div key={ti} className="turn turn-user">
              <div className="turn-user-bubble">
                {m.images && m.images.length > 0 ? (
                  <ImageThumbs
                    images={m.images}
                    onPreview={setPreview}
                    onMenu={openMenu}
                  />
                ) : null}
                {m.files && m.files.length > 0 ? (
                  <div className="msg-files">
                    {m.files.map((f, fi) => (
                      <span key={fi} className="msg-file-chip" title={f.name}>
                        {f.kind === 'document' ? 'PDF' : '文件'} · {f.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.text ? <div className="msg-plain">{m.text}</div> : null}
              </div>
              {clock ? <div className="turn-meta turn-meta-user">{clock}</div> : null}
            </div>
          )
        }

        const { steps } = turn
        const workSteps = steps.filter((s) => s.kind === 'work')
        const textSteps = steps.filter((s) => s.kind === 'assistant')
        const meta = turnMeta(steps)

        return (
          <div key={ti} className="turn turn-assistant">
            {meta ? <div className="turn-meta">{meta}</div> : null}

            <div className="turn-rail">
              {workSteps.map((m, si) => (
                <div key={`w-${si}`} className="turn-step">
                  <WorkStep m={m} />
                </div>
              ))}

              {textSteps.map((m, si) => (
                <div key={`a-${si}`} className="turn-reply">
                  {m.images && m.images.length > 0 ? (
                    <ImageThumbs
                      images={m.images}
                      onPreview={setPreview}
                      onMenu={openMenu}
                    />
                  ) : null}
                  {m.text ? <Markdown text={m.text} /> : null}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {menu ? (
        <div
          className="ctx-menu img-ctx"
          style={{
            top: Math.min(menu.y, window.innerHeight - 100),
            left: Math.min(menu.x, window.innerWidth - 180),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              setPreview(menu.src)
              setMenu(null)
            }}
          >
            放大查看
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => void copyImage(menu.src)}
          >
            复制图片
          </button>
        </div>
      ) : null}

      {preview ? (
        <ImageLightbox
          src={preview}
          onClose={() => setPreview(null)}
          onCopy={(src) => void copyImage(src)}
        />
      ) : null}
    </div>
  )
}
