import type { ApprovalPreview } from './usePanelChat'

export function ApprovalDetails({ preview, input }: { preview?: ApprovalPreview | null; input: unknown }) {
  return <>
    {preview?.kind === 'command' && <>
      <div className="approval-path">{preview.explicitCwd ? '工作目录' : '会话工作目录'} <code>{preview.cwd}</code></div>
      <pre className="approval-command" aria-label="完整命令">{preview.command}</pre>
    </>}
    {preview?.kind === 'file' && <>
      <div className="approval-path">文件 <code>{preview.file}</code></div>
      {preview.note && <div className="approval-note">{preview.note}</div>}
      {preview.lines.length > 0 && <pre className="approval-diff" aria-label="拟修改的内容">
        {preview.lines.map((line, index) => (
          <span key={index} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined}>{line}{'\n'}</span>
        ))}
      </pre>}
    </>}
    <details className="approval-raw">
      <summary>原始参数</summary>
      <pre>{JSON.stringify(input, null, 2)}</pre>
    </details>
  </>
}
