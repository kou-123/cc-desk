export type FolderPickerOpts = {
  title?: string
  defaultPath?: string
  message?: string
  buttonLabel?: string
  /** default true — allow ⌘/Ctrl multi-select */
  multi?: boolean
}

type ClaudePanelBridge = {
  isElectron: boolean
  platform: string
  selectFolder?: (
    opts?: FolderPickerOpts,
  ) => Promise<string | string[] | null>
  copyImage?: (payload: {
    data?: ArrayBuffer | number[]
    filePath?: string
  }) => Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    claudePanel?: ClaudePanelBridge
  }
}

export function isElectronApp() {
  return !!window.claudePanel?.isElectron
}

/** Single folder. Returns null if cancelled. */
export async function pickFolder(
  opts: FolderPickerOpts = {},
): Promise<string | null> {
  if (!window.claudePanel?.selectFolder) return null
  const result = await window.claudePanel.selectFolder({ ...opts, multi: false })
  if (Array.isArray(result)) return result[0] || null
  return result
}

/** Multiple folders (⌘-click on macOS). Returns [] if cancelled. */
export async function pickFolders(
  opts: FolderPickerOpts = {},
): Promise<string[]> {
  if (!window.claudePanel?.selectFolder) return []
  const result = await window.claudePanel.selectFolder({
    ...opts,
    multi: opts.multi !== false,
  })
  if (Array.isArray(result)) return result.filter(Boolean)
  if (typeof result === 'string' && result) return [result]
  return []
}

/** Copy an image URL (/api/media, blob:, data:, http…) to the system clipboard. */
export async function copyImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Failed to load image (${res.status})`)
  let blob = await res.blob()

  // Electron nativeImage is happiest with PNG/JPEG buffers.
  if (
    blob.type &&
    !/^image\/(png|jpe?g)$/i.test(blob.type) &&
    window.claudePanel?.copyImage
  ) {
    const bmp = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to convert image')
    ctx.drawImage(bmp, 0, 0)
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
        'image/png',
      )
    })
  }

  const buf = await blob.arrayBuffer()

  if (window.claudePanel?.copyImage) {
    const result = await window.claudePanel.copyImage({
      data: Array.from(new Uint8Array(buf)),
    })
    if (!result?.ok) throw new Error(result?.error || 'Copy failed')
    return
  }

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const type = blob.type || 'image/png'
    await navigator.clipboard.write([
      new ClipboardItem({ [type]: blob }),
    ])
    return
  }

  throw new Error('Clipboard API unavailable')
}
