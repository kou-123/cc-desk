import { useMemo, useState } from 'react'
import { basename } from './lib'
import type { ProjectNode } from './lib'
import { IconFolder, IconCompose } from './icons'
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
  const withPath = useMemo(
    () => projects.filter((p) => !!p.cwd),
    [projects],
  )
  const preferred = withPath.find((p) => p.key === preferredKey) || null
  const native = isElectronApp()

  const [name, setName] = useState(preferred?.name || '')
  const [paths, setPaths] = useState<string[]>(
    preferred?.cwd
      ? uniqPaths([preferred.cwd, ...(preferred.addDirs || [])])
      : [],
  )
  /** multi-select known projects by key (⌘/Ctrl click) */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(preferred ? [preferred.key] : []),
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
      setSelectedKeys(new Set())
    }
  }

  const toggleKnown = (key: string, e: React.MouseEvent) => {
    const project = withPath.find((p) => p.key === key)
    if (!project?.cwd) return

    const multi = e.metaKey || e.ctrlKey
    setSelectedKeys((prev) => {
      const next = new Set(multi ? prev : [])
      if (next.has(key)) next.delete(key)
      else next.add(key)

      const collected: string[] = []
      for (const k of next) {
        const p = withPath.find((x) => x.key === k)
        if (!p?.cwd) continue
        collected.push(p.cwd)
        for (const d of p.addDirs || []) collected.push(d)
      }
      // Keep manually picked paths that aren't from known list? Simpler: replace from selection
      if (next.size > 0) {
        applyPaths(collected, true)
      }
      return next
    })
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

  const submit = async (startNow: boolean) => {
    if (!cwd) return
    // If exactly one known saved workspace selected, reuse its id
    let workspaceId: string | undefined
    if (selectedKeys.size === 1) {
      const only = withPath.find((p) => selectedKeys.has(p.key))
      workspaceId = only?.workspace?.id
    }
    await onConfirm({
      name: name.trim() || basename(cwd),
      cwd,
      addDirs,
      workspaceId,
      startNow,
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
          <div className="explain">
            <strong>创建工作空间后再开始聊天</strong>
            可点「打开文件选择器」选文件夹（⌘ 多选），或 ⌘
            点选下方已知项目。第一个是 Primary，其余作为{' '}
            <code>--add-dir</code>。
          </div>

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
                  <button
                    type="button"
                    className="name linkish"
                    onClick={() => makePrimary(f.path)}
                    title="设为 Primary"
                  >
                    {basename(f.path)}
                  </button>
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

          {withPath.length > 0 && (
            <div className="field">
              <label>或从已知项目添加（⌘ / Ctrl 多选）</label>
              <div className="pick-list">
                {withPath.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`pick-row ${selectedKeys.has(p.key) ? 'active' : ''}`}
                    onClick={(e) => toggleKnown(p.key, e)}
                  >
                    <span className="ico">
                      <IconFolder />
                    </span>
                    <span className="meta">
                      <span className="name">{p.name}</span>
                      <span className="path">{p.cwd}</span>
                    </span>
                    {p.workspace && <span className="badge">saved</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <div className="right">
            <button
              type="button"
              className="btn"
              disabled={busy || !canSubmit}
              onClick={() => void submit(false)}
            >
              仅保存
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !canSubmit}
              onClick={() => void submit(true)}
            >
              <IconCompose size={14} />
              开始聊天
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
