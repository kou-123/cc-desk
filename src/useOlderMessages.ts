import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { api } from './api'
import type { ChatBlock } from './MessageList'

export function useOlderMessages(
  id: string | undefined,
  tail: ChatBlock[],
  scroll: RefObject<HTMLDivElement | null>,
  onError: (message: string, error?: boolean) => void,
) {
  const [pages, setPages] = useState<{ id: string; blocks: ChatBlock[] }>()
  const request = useRef<AbortController | null>(null)
  const first = tail[0]?.historyIndex
  const messages = useMemo(() => {
    if (!pages || pages.id !== id || first === undefined) return tail
    const last = pages.blocks.at(-1)?.historyIndex
    if (last === undefined || last < first - 1) return tail
    return [...pages.blocks.filter(b => b.historyIndex! < first), ...tail]
  }, [id, tail, pages, first])
  const cursor = messages[0]?.historyIndex ?? 0

  useLayoutEffect(() => {
    setPages(undefined)
    return () => { request.current?.abort(); request.current = null }
  }, [id])

  async function loadOlder() {
    if (!id || !cursor || request.current) return
    const controller = new AbortController()
    request.current = controller
    try {
      const page = await api.sessionDetail(id, cursor, controller.signal)
      const el = scroll.current
      if (controller.signal.aborted || !el || !page.messages.length) return
      const top = el.getBoundingClientRect().top
      const anchor = Array.from(el.querySelectorAll<HTMLElement>('[data-history-index]'))
        .find(node => node.getBoundingClientRect().bottom > top)
      const index = anchor?.dataset.historyIndex
      const anchorTop = anchor?.getBoundingClientRect().top
      // Commit before measuring again so even a split assistant turn keeps
      // the same visible block at the same pixel offset before the next paint.
      flushSync(() => setPages({ id, blocks: [
        ...page.messages, ...messages.filter(b => b.historyIndex !== undefined),
      ] }))
      const next = index === undefined ? null : el.querySelector(`[data-history-index="${index}"]`)
      if (next && anchorTop !== undefined) el.scrollTop += next.getBoundingClientRect().top - anchorTop
    } catch (err) {
      if (!controller.signal.aborted) onError(err instanceof Error ? err.message : String(err), true)
    } finally {
      if (request.current === controller) request.current = null
    }
  }

  return { messages, cursor, loadOlder }
}
