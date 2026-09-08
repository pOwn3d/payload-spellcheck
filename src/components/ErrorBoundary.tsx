/**
 * AdminErrorBoundary — containment for the components this plugin injects into
 * someone else's admin panel.
 *
 * Why it exists: Payload mounts `Field`, `Cell` and view components from the
 * import map, so the plugin has no ancestor of its own in the host's tree. An
 * uncaught render error therefore propagates up to Payload's own root and
 * unmounts the whole screen. The worst case is `SpellCheckScoreCell`, rendered
 * once per row of a list view: a single bad row would blank the entire
 * collection listing of a host collection the plugin only decorates.
 *
 * Scope, stated plainly: a React error boundary catches errors thrown during
 * RENDER, in lifecycle methods and in constructors. It does NOT catch rejected
 * promises inside `useEffect`, nor errors thrown from event handlers — the
 * `fetch` calls in these components need their own `catch`, which they have.
 *
 * Differences from the first version shipped in payload-support:
 *  - `resetKeys`: an error latched forever until the page was reloaded, even
 *    once the offending document was gone. Changing a reset key clears it.
 *  - retrying remounts the subtree (`key` on the children) instead of merely
 *    clearing the flag, which re-rendered the same failed tree.
 *  - the screen shows a generic sentence; `error.message` goes to the console
 *    only. Payload error messages routinely carry document titles, slugs and
 *    SQL fragments, and this panel can render inside a list view visible to
 *    lower-privileged editors.
 *  - `--theme-*` tokens instead of hardcoded hex, so the panel follows the
 *    host's light/dark theme.
 *  - `role="alert"` so assistive technology announces the failure.
 *  - strings come from the plugin's own i18n.
 */

'use client'

import React from 'react'
import { useSpellcheckI18n } from './useSpellcheckI18n.js'

export interface AdminErrorBoundaryProps {
  children?: React.ReactNode
  /**
   * Rendered in place of the default panel. Pass `null` for silent degradation
   * — the right choice inside a list-view cell or a sidebar field, where a red
   * panel repeated on every row is worse than showing nothing.
   * Omitting the prop entirely keeps the default panel.
   */
  fallback?: React.ReactNode
  /** Name used to prefix the console message. */
  viewName?: string
  /**
   * When any of these values changes while an error is latched, the boundary
   * clears itself and remounts its children. Typically the id of the row or
   * document being rendered.
   */
  resetKeys?: unknown[]
}

interface AdminErrorBoundaryState {
  hasError: boolean
  /** Bumped on every reset; used as the children's `key` to force a remount. */
  resetCount: number
}

/**
 * True when two `resetKeys` lists differ (length or any element, compared with
 * `Object.is`). Exported for unit tests: this is the whole reset contract.
 *
 * `undefined` on both sides means "no reset keys", which never changes.
 */
export function resetKeysChanged(prev?: unknown[], next?: unknown[]): boolean {
  if (prev === next) return false
  if (!prev || !next) return Boolean(prev) !== Boolean(next)
  if (prev.length !== next.length) return true
  return prev.some((value, i) => !Object.is(value, next[i]))
}

/**
 * Default panel. Split out of the class so it can use the i18n hook — class
 * components cannot call hooks.
 */
const DefaultErrorFallback: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const t = useSpellcheckI18n()

  return (
    <div
      role="alert"
      style={{
        padding: '20px',
        borderRadius: '6px',
        backgroundColor: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-150)',
        color: 'var(--theme-text)',
        fontSize: '14px',
      }}
    >
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
        {t?.errorBoundaryTitle ?? "Cette section n'a pas pu s'afficher"}
      </p>
      <p
        style={{
          margin: '0 0 16px',
          fontSize: '13px',
          // -650 rather than -500: the latter is 3.3:1 on the light theme,
          // below the 4.5:1 required for body text.
          color: 'var(--theme-elevation-650)',
        }}
      >
        {t?.errorBoundaryHint ??
          'Le reste de la page reste utilisable. Le détail technique est dans la console du navigateur.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: '8px 16px',
          fontSize: '13px',
          fontWeight: 600,
          border: 'none',
          borderRadius: '4px',
          backgroundColor: 'var(--theme-elevation-900)',
          color: 'var(--theme-elevation-0)',
          cursor: 'pointer',
        }}
      >
        {t?.errorBoundaryRetry ?? 'Réessayer'}
      </button>
    </div>
  )
}

export class AdminErrorBoundary extends React.Component<
  AdminErrorBoundaryProps,
  AdminErrorBoundaryState
> {
  constructor(props: AdminErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, resetCount: 0 }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(): Pick<AdminErrorBoundaryState, 'hasError'> {
    // The error object itself is deliberately not kept in state: nothing in the
    // rendered output may quote it. componentDidCatch logs it instead.
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[spellcheck/${this.props.viewName || 'component'}]`, error, errorInfo)
  }

  componentDidUpdate(prevProps: AdminErrorBoundaryProps): void {
    // Only ever resets an error that is already latched, so this cannot loop:
    // reset() sets hasError to false and the next pass returns immediately.
    if (!this.state.hasError) return
    if (resetKeysChanged(prevProps.resetKeys, this.props.resetKeys)) this.reset()
  }

  reset(): void {
    this.setState((prev) => ({ hasError: false, resetCount: prev.resetCount + 1 }))
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      // `!== undefined` and not a truthiness test: `fallback={null}` is the
      // documented way to degrade silently and must not fall through to the
      // default panel.
      if (this.props.fallback !== undefined) return this.props.fallback
      return <DefaultErrorFallback onRetry={this.reset} />
    }

    // Keyed so that "Retry" remounts the subtree from scratch. Without it React
    // re-renders the very tree that threw, with its state intact, and the
    // boundary catches again on the same tick.
    return <React.Fragment key={this.state.resetCount}>{this.props.children}</React.Fragment>
  }
}

export default AdminErrorBoundary
