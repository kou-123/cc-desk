import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { structuredPatch } from 'diff'

async function readOriginal(file) {
  let handle
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null
    const bytes = await handle.readFile()
    return bytes.includes(0) ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (err) {
    return err.code === 'ENOENT' ? undefined : null
  } finally {
    await handle?.close()
  }
}

function diffLines(before, after) {
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: 3, timeout: 150 })
  return patch?.hunks.flatMap(h => [
    `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines,
  ])
}

export async function approvalPreview(name, input, cwd) {
  if (!input || typeof input !== 'object') return null
  if ((name === 'Bash' || name === 'PowerShell') && typeof input.command === 'string') {
    return { kind: 'command', cwd: path.resolve(cwd, typeof input.cwd === 'string' ? input.cwd : '.'),
      explicitCwd: typeof input.cwd === 'string', command: input.command }
  }
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return null
  const target = input.file_path ?? input.notebook_path
  if (!target || typeof target !== 'string') return null
  const file = path.resolve(cwd, target)
  const original = await readOriginal(file)
  const preview = { kind: 'file', file, lines: [], note: '' }
  let before = original ?? ''
  let after
  if (name === 'Write' && typeof input.content === 'string') {
    if (original === null) return { ...preview, note: '无法预览原文件，请展开原始参数查看拟写入内容。' }
    if (original === undefined) preview.note = '新建文件'
    after = input.content
  } else if (name === 'NotebookEdit') {
    try {
      const cells = JSON.parse(before).cells
      const cell = cells.find(c => c.id === input.cell_id)
      const insert = input.edit_mode === 'insert'
      if (!insert && !cell) throw new Error()
      before = insert ? '' : [].concat(cell.source).join('')
      after = input.edit_mode === 'delete' ? '' : input.new_source
      preview.note = [input.edit_mode || 'replace', input.cell_id].filter(Boolean).join(' · ')
    } catch { return { ...preview, note: '无法定位单元格，请展开原始参数核对。' } }
  } else {
    const edits = name === 'MultiEdit' ? input.edits : [input]
    if (!Array.isArray(edits)) return null
    after = before
    for (const edit of edits) {
      const { old_string: old, new_string: next, replace_all: all } = edit || {}
      if (typeof old !== 'string' || typeof next !== 'string') return null
      const i = after.indexOf(old)
      if (!old || i < 0 || (!all && after.indexOf(old, i + old.length) >= 0)) {
        if (edits.length > 1) return { ...preview, note: '无法匹配原文件，请展开原始参数核对各项修改。' }
        preview.note = '按请求片段预览，尚未定位到原文件中的唯一位置。'
        before = old
        after = next
        break
      }
      after = all ? after.split(old).join(next) : after.slice(0, i) + next + after.slice(i + old.length)
    }
  }
  if (typeof after !== 'string') return null
  const lines = diffLines(before, after)
  if (!lines) return { ...preview, note: '差异较大，请展开原始参数核对。' }
  return { ...preview, lines, note: preview.note || (lines.length ? '' : '文本内容相同') }
}
