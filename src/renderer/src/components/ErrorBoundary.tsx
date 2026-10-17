import { Component, type ReactNode } from 'react'

/** Keeps a render bug from blanking the whole window; the workspace on disk is unaffected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <h2>Something went wrong</h2>
        <pre className="mono">{this.state.error.stack ?? this.state.error.message}</pre>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload window
        </button>
      </div>
    )
  }
}
