type Props = {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  secondaryLabel?: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
  onSecondary?: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = '删除',
  cancelLabel = '取消',
  secondaryLabel,
  danger = true,
  busy,
  onCancel,
  onConfirm,
  onSecondary,
}: Props) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="confirm-title">{title}</h2>
        </div>
        <div className="modal-body confirm-body">
          {body.split('\n').map((line, i) =>
            line ? (
              <p key={i}>{line}</p>
            ) : (
              <br key={i} />
            ),
          )}
        </div>
        <div className="modal-foot">
          <div className="right">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            {secondaryLabel && onSecondary ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onSecondary}
              >
                {secondaryLabel}
              </button>
            ) : null}
            <button
              type="button"
              className={`btn ${danger ? 'danger' : 'primary'}`}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? '处理中…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
