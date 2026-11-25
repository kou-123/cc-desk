import { useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  label: string
  children: ReactNode
  /** Delay before showing, ms. Default 800. */
  delayMs?: number
  className?: string
  side?: 'right' | 'top' | 'bottom'
}

export function Tip({
  label,
  children,
  delayMs = 800,
  className,
  side = 'right',
}: Props) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | null>(null)

  const clear = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  const showSoon = () => {
    clear()
    timer.current = window.setTimeout(() => setOpen(true), delayMs)
  }

  const hide = () => {
    clear()
    setOpen(false)
  }

  useEffect(() => () => clear(), [])

  return (
    <span
      className={`tip-wrap ${className || ''}`}
      onMouseEnter={showSoon}
      onMouseLeave={hide}
      onFocus={showSoon}
      onBlur={hide}
    >
      {children}
      {open && label ? (
        <span className={`tip-bubble tip-${side}`} role="tooltip">
          {label}
        </span>
      ) : null}
    </span>
  )
}
