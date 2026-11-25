import { useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { copyImageFromUrl } from './native'

/** Copy any image src (http(s), /api/media, blob:, data:) to the clipboard. */
export async function copyImageToClipboard(src: string) {
  try {
    await copyImageFromUrl(src)
    return
  } catch {
    /* fall through */
  }

  let blob: Blob
  if (src.startsWith('data:')) {
    const res = await fetch(src)
    blob = await res.blob()
  } else {
    const res = await fetch(src)
    if (!res.ok) throw new Error('无法读取图片')
    blob = await res.blob()
  }

  if (blob.type && blob.type !== 'image/png' && !blob.type.includes('png')) {
    const bmp = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法转换图片')
    ctx.drawImage(bmp, 0, 0)
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('转 PNG 失败'))),
        'image/png',
      )
    })
  }

  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error('当前环境不支持复制图片')
  }
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || 'image/png']: blob }),
  ])
}

export function ImageLightbox({
  src,
  onClose,
  onCopy,
}: {
  src: string
  onClose: () => void
  onCopy: (src: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="img-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <div className="img-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="btn primary"
          onClick={() => onCopy(src)}
        >
          复制图片
        </button>
        <button type="button" className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
      <img
        src={src}
        alt="预览"
        className="img-lightbox-full"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          onCopy(src)
        }}
      />
    </div>
  )
}

export function ImageThumbs({
  images,
  onPreview,
  onMenu,
}: {
  images: string[]
  onPreview: (src: string) => void
  onMenu?: (e: ReactMouseEvent, src: string) => void
}) {
  return (
    <div className="msg-images">
      {images.map((src, ii) => (
        <button
          key={`${src}-${ii}`}
          type="button"
          className="msg-thumb"
          title="点击放大 · 右键复制"
          onClick={() => onPreview(src)}
          onContextMenu={(e) => {
            if (onMenu) onMenu(e, src)
            else {
              e.preventDefault()
              onPreview(src)
            }
          }}
        >
          <img
            src={src}
            alt={`图片 ${ii + 1}`}
            className="msg-thumb-img"
            loading="lazy"
            draggable={false}
          />
          <span className="msg-thumb-hint">点击放大</span>
        </button>
      ))}
    </div>
  )
}
