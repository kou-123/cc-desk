import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react'
import type { ChatBlock } from './MessageList'

export type MinimapTurn = {
  index: number
  label: string
}

function clip(s: string, n = 48) {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** One tick per user question (ignore assistant replies). */
export function buildMinimapTurns(messages: ChatBlock[]): MinimapTurn[] {
  const out: MinimapTurn[] = []
  let index = 0
  for (const m of messages) {
    if (m.kind !== 'user') continue
    const label =
      clip(m.text || '') ||
      (m.images?.length ? `图片 ×${m.images.length}` : '') ||
      (m.files?.length ? `附件 ×${m.files.length}` : '') ||
      '用户消息'
    out.push({ index, label })
    index += 1
  }
  return out
}

type Props = {
  scrollRef: RefObject<HTMLElement | null>
  messages: ChatBlock[]
}

export function ChatMinimap({ scrollRef, messages }: Props) {
  const turns = useMemo(() => buildMinimapTurns(messages), [messages])
  const [active, setActive] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  const turnTop = useCallback((node: HTMLElement, root: HTMLElement) => {
    return (
      node.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop
    )
  }, [])

  const syncActive = useCallback(() => {
    const root = scrollRef.current
    if (!root || !turns.length) return
    const nodes = root.querySelectorAll<HTMLElement>('[data-user-turn]')
    if (!nodes.length) return
    const anchor = root.scrollTop + Math.min(120, root.clientHeight * 0.22)
    let chosen = 0
    nodes.forEach((node) => {
      const idx = Number(node.dataset.userTurn)
      if (!Number.isFinite(idx)) return
      if (turnTop(node, root) <= anchor) chosen = idx
    })
    setActive(chosen)
  }, [scrollRef, turns.length, turnTop])

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    syncActive()
    const onScroll = () => syncActive()
    root.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => syncActive())
    ro.observe(root)
    return () => {
      root.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [scrollRef, syncActive, messages])

  if (turns.length < 2) return null

  function jump(index: number) {
    const root = scrollRef.current
    if (!root) return
    const node = root.querySelector<HTMLElement>(`[data-user-turn="${index}"]`)
    if (!node) return
    const top = Math.max(0, turnTop(node, root) - 12)
    root.scrollTo({ top, behavior: 'smooth' })
    setActive(index)
  }

  const tip = hover != null ? turns[hover] : null

  return (
    <nav className="chat-minimap" aria-label="提问目录">
      <div className="chat-minimap-track">
        {turns.map((t) => (
          <button
            key={t.index}
            type="button"
            className={`chat-minimap-tick${t.index === active ? ' active' : ''}`}
            title={t.label}
            aria-label={t.label}
            aria-current={t.index === active ? 'true' : undefined}
            onMouseEnter={() => setHover(t.index)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(t.index)}
            onBlur={() => setHover(null)}
            onClick={() => jump(t.index)}
          />
        ))}
      </div>
      {tip ? (
        <div className="chat-minimap-tip" role="tooltip">
          <span className="chat-minimap-tip-kind">提问</span>
          <span className="chat-minimap-tip-text">{tip.label}</span>
        </div>
      ) : null}
    </nav>
  )
}
