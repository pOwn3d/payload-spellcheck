/**
 * Regression tests for the containment added around the components this plugin
 * injects into someone else's admin panel.
 *
 * There is no DOM and no react-dom here on purpose: this package ships zero
 * runtime dependencies and its test environment is `node`. Everything asserted
 * below is reachable through the class's own contract — the static
 * `getDerivedStateFromError`, `render()`, and the exported reset predicate — so
 * the tests exercise the real component rather than a copy of its logic.
 *
 * Each assertion is written so that it FAILS against the boundary that shipped
 * in payload-support and was the starting point for this file:
 *  - that version had no `resetKeys` at all;
 *  - it treated `fallback` as a truthy check, so `fallback={null}` silently fell
 *    through to the default red panel — which is what a list-view cell must
 *    never render, once per row;
 *  - it kept the caught error in state and printed `error.message` on screen;
 *  - retrying only cleared the flag, re-rendering the very tree that threw
 *    instead of remounting it.
 */

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { AdminErrorBoundary, resetKeysChanged } from '../components/ErrorBoundary.js'

/** Walk a rendered element tree and collect every string it would display. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  const element = node as { props?: { children?: unknown } }
  if (element.props && 'children' in element.props) collectText(element.props.children, out)
  return out
}

/** Instantiate the boundary the way React would, without a renderer. */
function mount(props: Record<string, unknown>): AdminErrorBoundary {
  const instance = new AdminErrorBoundary(props as never)
  // React assigns the result of getDerivedStateFromError/setState itself; the
  // tests below do it explicitly where they need an error latched.
  return instance
}

describe('resetKeysChanged', () => {
  it('is false when both sides are absent', () => {
    expect(resetKeysChanged(undefined, undefined)).toBe(false)
  })

  it('is false for equal keys, so a re-render never clears a live error', () => {
    expect(resetKeysChanged(['pages', 12], ['pages', 12])).toBe(false)
  })

  it('is true when a key changes — the list view scrolled onto another row', () => {
    expect(resetKeysChanged(['pages', 12], ['pages', 13])).toBe(true)
  })

  it('is true when the number of keys changes', () => {
    expect(resetKeysChanged([1], [1, 2])).toBe(true)
  })

  it('is true when keys appear or disappear entirely', () => {
    expect(resetKeysChanged(undefined, [1])).toBe(true)
    expect(resetKeysChanged([1], undefined)).toBe(true)
  })

  it('compares with Object.is, so NaN keys do not loop forever', () => {
    expect(resetKeysChanged([NaN], [NaN])).toBe(false)
  })
})

describe('AdminErrorBoundary', () => {
  it('renders its children while nothing has thrown', () => {
    const instance = mount({ children: 'contenu' })
    expect(collectText(instance.render())).toEqual(['contenu'])
  })

  it('flags the error without keeping it in state', () => {
    const derived = AdminErrorBoundary.getDerivedStateFromError()
    expect(derived).toEqual({ hasError: true })
    // Nothing else: an error object in state is an error object one `render`
    // away from being printed on a page a low-privileged editor can open.
    expect(Object.keys(derived)).toEqual(['hasError'])
  })

  it('honours `fallback={null}` instead of falling through to the default panel', () => {
    const instance = mount({ children: 'contenu', fallback: null })
    instance.state = { hasError: true, resetCount: 0 }
    expect(instance.render()).toBeNull()
  })

  it('still shows the default panel when no fallback prop is passed', () => {
    const instance = mount({ children: 'contenu' })
    instance.state = { hasError: true, resetCount: 0 }
    const rendered = instance.render() as React.ReactElement
    expect(rendered).not.toBeNull()
    // The panel is a component, not raw markup, so assert on the element type
    // rather than on the strings it will resolve to at render time.
    expect(typeof (rendered as { type: unknown }).type).toBe('function')
  })

  it('never quotes the thrown message on screen — the console gets it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const instance = mount({ children: 'contenu', viewName: 'SpellCheckScoreCell' })
    const boom = new Error('SQLITE_ERROR: no such column: drafts.secret_slug')
    instance.componentDidCatch(boom, { componentStack: '' } as React.ErrorInfo)

    expect(spy).toHaveBeenCalledWith('[spellcheck/SpellCheckScoreCell]', boom, expect.anything())

    instance.state = { hasError: true, resetCount: 0 }
    const shown = collectText(instance.render()).join(' ')
    expect(shown).not.toContain('secret_slug')
    spy.mockRestore()
  })

  it('remounts the subtree on reset instead of re-rendering the tree that threw', () => {
    const instance = mount({ children: 'contenu' })
    const before = instance.render() as React.ReactElement
    instance.state = { hasError: false, resetCount: 1 }
    const after = instance.render() as React.ReactElement
    // A different `key` is what makes React drop the failed subtree and build a
    // fresh one; without it the retry button re-renders the same broken state.
    expect(String(before.key)).not.toBe(String(after.key))
  })

  it('clears a latched error when a reset key changes', () => {
    const instance = mount({ children: 'contenu', resetKeys: ['pages', 12] })
    const applied: Array<{ hasError: boolean; resetCount: number }> = []
    instance.setState = ((updater: unknown) => {
      const next = (updater as (s: typeof instance.state) => typeof instance.state)(instance.state)
      instance.state = { ...instance.state, ...next }
      applied.push(instance.state)
    }) as typeof instance.setState

    instance.state = { hasError: true, resetCount: 0 }
    ;(instance as { props: Record<string, unknown> }).props = {
      children: 'contenu',
      resetKeys: ['pages', 13],
    }
    instance.componentDidUpdate({ children: 'contenu', resetKeys: ['pages', 12] })

    expect(applied).toHaveLength(1)
    expect(instance.state.hasError).toBe(false)
    expect(instance.state.resetCount).toBe(1)
  })

  it('does not re-enter when the keys are unchanged', () => {
    const instance = mount({ children: 'contenu', resetKeys: ['pages', 12] })
    instance.setState = vi.fn() as unknown as typeof instance.setState
    instance.state = { hasError: true, resetCount: 0 }
    instance.componentDidUpdate({ children: 'contenu', resetKeys: ['pages', 12] })
    expect(instance.setState).not.toHaveBeenCalled()
  })

  it('ignores key changes while no error is latched', () => {
    const instance = mount({ children: 'contenu', resetKeys: ['pages', 12] })
    instance.setState = vi.fn() as unknown as typeof instance.setState
    instance.componentDidUpdate({ children: 'contenu', resetKeys: ['pages', 99] })
    expect(instance.setState).not.toHaveBeenCalled()
  })
})
