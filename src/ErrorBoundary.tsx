import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallbackTitle?: string
}

type State = {
  error: Error | null
}

/** Prevent a render crash from blanking the whole Electron window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CC Desk] UI crash', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary" role="alert">
        <h2>{this.props.fallbackTitle || '页面出错了'}</h2>
        <p className="error-boundary-msg">
          {this.state.error.message || String(this.state.error)}
        </p>
        <button
          type="button"
          className="btn primary"
          onClick={() => this.setState({ error: null })}
        >
          重试
        </button>
      </div>
    )
  }
}
