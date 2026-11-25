import { useEffect, useState } from 'react'
import { api, type FsItem } from './api'

type Props = {
  mode?: 'dir' | 'file'
  onPick: (path: string) => void
  initialPath?: string
}

export function PathPicker({ mode = 'dir', onPick, initialPath = '~' }: Props) {
  const [dir, setDir] = useState(initialPath)
  const [parent, setParent] = useState('')
  const [items, setItems] = useState<FsItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await api.listFs(dir)
        if (cancelled) return
        setDir(data.path)
        setParent(data.parent)
        setItems(data.items)
        setError('')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dir])

  const visible =
    mode === 'dir' ? items.filter((it) => it.isDirectory) : items

  return (
    <div className="picker-pop">
      <div className="picker-bar">
        <button
          type="button"
          className="btn ghost"
          disabled={!parent || parent === dir}
          onClick={() => setDir(parent)}
        >
          ↑
        </button>
        <code title={dir}>{dir}</code>
        {mode === 'dir' && (
          <button type="button" className="btn primary" onClick={() => onPick(dir)}>
            选此目录
          </button>
        )}
      </div>
      <div className="picker-list">
        {error && <div style={{ padding: 12, color: '#c23b2a' }}>{error}</div>}
        {!error &&
          visible.map((it) => (
            <button
              key={it.path}
              type="button"
              className="picker-item"
              onClick={() => {
                if (it.isDirectory) setDir(it.path)
                else if (mode === 'file') onPick(it.path)
              }}
            >
              <span className="icon">{it.isDirectory ? 'DIR' : 'FILE'}</span>
              <span>{it.name}</span>
            </button>
          ))}
      </div>
    </div>
  )
}
