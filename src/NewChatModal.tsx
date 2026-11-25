import { useMemo, useState } from 'react'
import { basename } from './lib'
import type { ProjectNode } from './lib'
import { IconFolder } from './icons'
import { isElectronApp, pickFolders } from './native'
import { PathPicker } from './PathPicker'

export type NewChatResult = {
  name: string
  cwd: string
  addDirs: string[]
  workspaceId?: string
  startNow: boolean
}

type Props = {
  projects: ProjectNode[]
  preferredKey?: string | null
  busy?: boolean
  onClose: () => void
  onConfirm: (result: NewChatResult) => Promise<void>
}

function uniqPaths(paths: string[]) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

export function NewChatModal({
  projects,
  preferredKey,
  busy,
  onClose,
  onConfirm,
}: Props) {
  const preferred =
    projects.find((p) => p.key === preferredKey && !!p.cwd) || null
  const native = isElectronApp()

  const [name, setName] = useState(preferred?.name || '')
  const [paths, setPaths] = useState<string[]>(
    preferred?.cwd
      ? uniqPaths([preferred.cwd, ...(preferred.addDirs || [])])
      : [],
  )
  const [webPick, setWebPick] = useState(false)

  const folders = useMemo(() => {
    return paths.map((path, i) => ({ path, primary: i === 0 }))
  }, [paths])

  const applyPaths = (next: string[], renameIfEmpty = true) => {
    const u = uniqPaths(next)
    setPaths(u)
    if (renameIfEmpty && u[0] && (!name.trim() || name === preferred?.name)) {
      setName(basename(u[0]))
    } else if (renameIfEmpty && u[0] && !name.trim()) {
      setName(basename(u[0]))
    }
  }

  const openSystemPicker = async () => {
    if (!native) {
      setWebPick(true)
      return
    }
    const chosen = await pickFolders({
      title: '选择项目 / 文件夹',
      defaultPath: paths[0] || undefined,
      message: '按住 ⌘ 可多选；选中的第一个为 Primary 主目录',
      buttonLabel: '打开',
      multi: true,
    })
    if (chosen.length) {
      applyPaths([...paths, ...chosen], !paths.length)
    }
  }

  const removeAt = (path: string) => {
    applyPaths(
      paths.filter((p) => p !== path),
      false,
    )
  }

  const makePrimary = (path: string) => {
    applyPaths([path, ...paths.filter((p) => p !== path)], false)
  }

  const canSubmit = paths.length > 0
  const cwd = paths[0] || null
  const addDirs = paths.slice(1)

  const submit = async () => {
    if (!cwd) return
    const samePreferred =
      preferred?.workspace?.id &&
      preferred.cwd === cwd &&
      uniqPaths([preferred.cwd, ...(preferred.addDirs || [])]).join('\0') ===
        uniqPaths([cwd, ...addDirs]).join('\0')
    await onConfirm({
      name: name.trim() || basename(cwd),
      cwd,
      addDirs,
      workspaceId: samePreferred ? preferred?.workspace?.id : undefined,
      startNow: true,
    })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>New chat</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>工作空间名称</label>
            <input
              value={name}
              placeholder="例如 ey-timp-dex"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>已选文件夹</label>
            <div className="folder-list">
              {folders.length === 0 && (
                <div className="folder-empty">
                  还没有选择文件夹，点下方按钮打开系统选择器
                </div>
              )}
              {folders.map((f) => (
                <div key={f.path} className="folder-row" title={f.path}>
                  <span className="ico">
                    <IconFolder />
                  </span>
                  <div className="folder-meta">
                    <button
                      type="button"
                      className="name linkish"
                      onClick={() => makePrimary(f.path)}
                      title="设为 Primary"
                    >
                      {basename(f.path)}
                    </button>
                    <span className="path truncatable" title={f.path}>
                      {f.path}
                    </span>
                  </div>
                  {f.primary ? (
                    <span className="badge">Primary</span>
                  ) : (
                    <button
                      type="button"
                      className="badge ghost"
                      onClick={() => makePrimary(f.path)}
                    >
                      设为 Primary
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeAt(f.path)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="add-folder"
                onClick={() => void openSystemPicker()}
              >
                <span className="ico">
                  <IconFolder />
                </span>
                <span>打开文件选择器</span>
                {native && <span className="hint">⌘ 多选</span>}
              </button>
            </div>
          </div>

          {!native && webPick && (
            <PathPicker
              mode="dir"
              onPick={(p) => {
                applyPaths([...paths, p], !paths.length)
                setWebPick(false)
              }}
            />
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <div className="right">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !canSubmit}
              onClick={() => void submit()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
