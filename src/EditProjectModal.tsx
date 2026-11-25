import { useEffect, useMemo, useState } from 'react'
import type { Workspace } from './api'
import { basename } from './lib'
import { IconFolder } from './icons'
import { isElectronApp, pickFolders } from './native'
import { PathPicker } from './PathPicker'

export type ProjectDraft = {
  id?: string
  name: string
  cwd: string | null
  addDirs: string[]
}

export type KnownRoot = {
  path: string
  label: string
}

type Props = {
  initial: ProjectDraft
  knownRoots?: KnownRoot[]
  startPicking?: boolean
  busy?: boolean
  onClose: () => void
  onSave: (draft: ProjectDraft) => Promise<void>
  onRemove?: () => Promise<void>
}

export function EditProjectModal({
  initial,
  knownRoots = [],
  startPicking = false,
  busy,
  onClose,
  onSave,
  onRemove,
}: Props) {
  const [name, setName] = useState(initial.name)
  const [cwd, setCwd] = useState<string | null>(initial.cwd)
  const [addDirs, setAddDirs] = useState<string[]>([...(initial.addDirs || [])])
  const [webPicking, setWebPicking] = useState(false)
  const native = isElectronApp()

  const folders: { path: string; primary: boolean }[] = []
  if (cwd) folders.push({ path: cwd, primary: true })
  for (const d of addDirs) {
    if (d && d !== cwd) folders.push({ path: d, primary: false })
  }

  const selected = useMemo(() => {
    const set = new Set<string>()
    if (cwd) set.add(cwd)
    for (const d of addDirs) set.add(d)
    return set
  }, [cwd, addDirs])

  const suggestions = useMemo(
    () =>
      knownRoots.filter(
        (r) => r.path && !selected.has(r.path) && r.path !== cwd,
      ),
    [knownRoots, selected, cwd],
  )

  const removeFolder = (path: string) => {
    if (path === cwd) {
      const next = addDirs[0] || null
      setCwd(next)
      setAddDirs(addDirs.filter((d) => d !== next && d !== path))
    } else {
      setAddDirs(addDirs.filter((d) => d !== path))
    }
  }

  const addFolders = (incoming: string[]) => {
    if (!incoming.length) return
    let nextCwd = cwd
    let nextAdd = [...addDirs]
    for (const path of incoming) {
      if (!path) continue
      if (!nextCwd) {
        nextCwd = path
        if (!name.trim() || name === 'New project') {
          setName(basename(path) || name)
        }
      } else if (path !== nextCwd && !nextAdd.includes(path)) {
        nextAdd.push(path)
      }
    }
    setCwd(nextCwd)
    setAddDirs(nextAdd)
    setWebPicking(false)
  }

  const addFolder = (path: string) => addFolders([path])

  const makePrimary = (path: string) => {
    if (path === cwd) return
    const rest = [cwd, ...addDirs].filter(
      (d): d is string => !!d && d !== path,
    )
    setCwd(path)
    setAddDirs(rest)
  }

  const openFolderPicker = async () => {
    if (native) {
      const chosen = await pickFolders({
        title: '选择项目 / 文件夹',
        defaultPath: cwd || undefined,
        message: '按住 ⌘ 可多选文件夹',
        buttonLabel: '打开',
        multi: true,
      })
      if (chosen.length) addFolders(chosen)
      return
    }
    setWebPicking((v) => !v)
  }

  useEffect(() => {
    if (!startPicking) return
    void openFolderPicker()
    // only on mount when requested
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Edit project</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Project name</label>
            <div className="name-row">
              <span className="ico">
                <IconFolder />
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="project name"
              />
            </div>
          </div>

          <div className="field">
            <label>Source folders</label>
            <div className="folder-list">
              {folders.length === 0 && (
                <div className="folder-empty">
                  还没有文件夹，点击 Add folder 用系统对话框选择
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
                    onClick={() => removeFolder(f.path)}
                    aria-label="Remove folder"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="add-folder"
                onClick={() => void openFolderPicker()}
              >
                <span className="ico">
                  <IconFolder />
                </span>
                <span>Add folder</span>
                {native && <span className="hint">⌘ 多选</span>}
              </button>
            </div>
          </div>

          {!native && webPicking && (
            <PathPicker
              mode="dir"
              initialPath={cwd || '~/code_workspace/webstorm_workspace'}
              onPick={addFolder}
            />
          )}

          {suggestions.length > 0 && (
            <div className="field">
              <label>从已知项目添加</label>
              <div className="suggest-list">
                {suggestions.slice(0, 24).map((r) => (
                  <button
                    key={r.path}
                    type="button"
                    className="suggest-chip"
                    title={r.path}
                    onClick={() => addFolder(r.path)}
                  >
                    <span className="ico">
                      <IconFolder size={14} />
                    </span>
                    <span>{r.label}</span>
                    <span className="plus">+</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {onRemove ? (
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              Remove local project
            </button>
          ) : (
            <span />
          )}
          <div className="right">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !name.trim()}
              onClick={() =>
                void onSave({
                  id: initial.id,
                  name: name.trim(),
                  cwd,
                  addDirs,
                })
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function workspaceToDraft(ws: Workspace): ProjectDraft {
  return {
    id: ws.id,
    name: ws.name,
    cwd: ws.cwd,
    addDirs: [...(ws.addDirs || [])],
  }
}
