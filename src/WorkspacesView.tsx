import { useMemo, useState } from 'react'
import { api, type Workspace } from './api'
import { PathPicker } from './PathPicker'

type Props = {
  workspaces: Workspace[]
  onChange: () => Promise<void>
  onToast: (msg: string, error?: boolean) => void
}

const blank = {
  name: '',
  cwd: '',
  note: '',
  addDirs: [] as string[],
  files: [] as string[],
}

export function WorkspacesView({ workspaces, onChange, onToast }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    workspaces[0]?.id ?? null,
  )
  const [draft, setDraft] = useState({ ...blank })
  const [picker, setPicker] = useState<'cwd' | 'addDir' | 'file' | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const selected = useMemo(
    () => workspaces.find((w) => w.id === selectedId) || null,
    [workspaces, selectedId],
  )

  const startCreate = () => {
    setCreating(true)
    setSelectedId(null)
    setDraft({ ...blank, name: 'New workspace' })
    setPicker(null)
  }

  const loadSelected = (w: Workspace) => {
    setCreating(false)
    setSelectedId(w.id)
    setDraft({
      name: w.name,
      cwd: w.cwd || '',
      note: w.note || '',
      addDirs: [...(w.addDirs || [])],
      files: [...(w.files || [])],
    })
    setPicker(null)
  }

  const save = async () => {
    setBusy(true)
    try {
      if (creating || !selectedId) {
        const { workspace } = await api.createWorkspace({
          name: draft.name,
          cwd: draft.cwd || null,
          addDirs: draft.addDirs,
          files: draft.files,
          note: draft.note,
        })
        await onChange()
        setCreating(false)
        setSelectedId(workspace.id)
        onToast(`已创建 ${workspace.name}`)
      } else {
        await api.updateWorkspace(selectedId, {
          name: draft.name,
          cwd: draft.cwd || null,
          addDirs: draft.addDirs,
          files: draft.files,
          note: draft.note,
        })
        await onChange()
        onToast('已保存')
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!selectedId || creating) return
    if (!confirm('删除这个 workspace？')) return
    setBusy(true)
    try {
      await api.deleteWorkspace(selectedId)
      await onChange()
      setSelectedId(null)
      setDraft({ ...blank })
      onToast('已删除')
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const launch = async () => {
    setBusy(true)
    try {
      let workspaceId = creating ? null : selectedId
      if (creating) {
        const { workspace } = await api.createWorkspace({
          name: draft.name,
          cwd: draft.cwd || null,
          addDirs: draft.addDirs,
          files: draft.files,
          note: draft.note,
        })
        await onChange()
        setCreating(false)
        setSelectedId(workspace.id)
        workspaceId = workspace.id
      }
      const result = await api.launch({
        workspaceId,
        cwd: draft.cwd || null,
        addDirs: draft.addDirs,
        files: draft.files,
        name: draft.name,
      })
      onToast(`已启动：${result.command}`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const onPick = (p: string) => {
    if (picker === 'cwd') setDraft((d) => ({ ...d, cwd: p }))
    if (picker === 'addDir') {
      setDraft((d) => ({
        ...d,
        addDirs: d.addDirs.includes(p) ? d.addDirs : [...d.addDirs, p],
      }))
    }
    if (picker === 'file') {
      setDraft((d) => ({
        ...d,
        files: d.files.includes(p) ? d.files : [...d.files, p],
      }))
    }
    setPicker(null)
  }

  return (
    <div className="layout">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Workspaces</h2>
            <div className="meta">{workspaces.length} 个配置</div>
          </div>
          <button type="button" className="btn primary" onClick={startCreate}>
            新建
          </button>
        </div>
        <div className="list">
          {workspaces.map((w, i) => (
            <button
              key={w.id}
              type="button"
              className={`row ${!creating && selectedId === w.id ? 'active' : ''}`}
              style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}
              onClick={() => loadSelected(w)}
            >
              <div className="row-title">
                <strong>{w.name}</strong>
                <time>{new Date(w.updatedAt).toLocaleDateString()}</time>
              </div>
              <div className="row-path">{w.cwd || '未设置 cwd'}</div>
              <div className="row-preview">
                {w.addDirs.length} dirs · {w.files.length} files
                {w.note ? ` · ${w.note}` : ''}
              </div>
            </button>
          ))}
          {workspaces.length === 0 && (
            <div className="empty">
              <strong>还没有 workspace</strong>
              把多个目录/文件收进一组，启动时自动 --add-dir
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{creating ? '新建 Workspace' : selected ? '编辑 Workspace' : '详情'}</h2>
        </div>
        {!creating && !selected ? (
          <div className="empty">
            <strong>选择或新建</strong>
            配置主目录、附加目录和关注文件
          </div>
        ) : (
          <div className="detail">
            <div className="form">
              <div className="field">
                <label>名称</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>

              <div className="field">
                <label>主目录 cwd</label>
                <div className="toolbar">
                  <input
                    className="search"
                    value={draft.cwd}
                    placeholder="/path/to/project"
                    onChange={(e) => setDraft((d) => ({ ...d, cwd: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPicker(picker === 'cwd' ? null : 'cwd')}
                  >
                    浏览
                  </button>
                </div>
              </div>

              <div className="field">
                <label>附加目录 (--add-dir)</label>
                <div className="chips">
                  {draft.addDirs.map((p) => (
                    <div key={p} className="chip" title={p}>
                      <span>{p}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            addDirs: d.addDirs.filter((x) => x !== p),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 8 }}
                  onClick={() => setPicker(picker === 'addDir' ? null : 'addDir')}
                >
                  + 添加目录
                </button>
              </div>

              <div className="field">
                <label>关注文件（会把父目录加入 add-dir）</label>
                <div className="chips">
                  {draft.files.map((p) => (
                    <div key={p} className="chip" title={p}>
                      <span>{p}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            files: d.files.filter((x) => x !== p),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 8 }}
                  onClick={() => setPicker(picker === 'file' ? null : 'file')}
                >
                  + 添加文件
                </button>
              </div>

              <div className="field">
                <label>备注</label>
                <textarea
                  rows={2}
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </div>

              {picker && (
                <div className="field">
                  <label>
                    {picker === 'cwd'
                      ? '选择主目录'
                      : picker === 'addDir'
                        ? '选择附加目录'
                        : '选择文件（点文件即添加）'}
                  </label>
                  <PathPicker
                    mode={picker === 'file' ? 'file' : 'dir'}
                    initialPath={draft.cwd || '~'}
                    onPick={onPick}
                  />
                </div>
              )}
            </div>

            <div className="actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy || !draft.name.trim()}
                onClick={() => void launch()}
              >
                启动 Claude
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !draft.name.trim()}
                onClick={() => void save()}
              >
                保存
              </button>
              {!creating && selected && (
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  删除
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
