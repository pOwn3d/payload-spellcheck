/**
 * Accessibility regressions, asserted on the component sources.
 *
 * Why source text and not a rendered DOM: this package declares
 * `dependencies: {}` and its test environment is `node`. Pulling jsdom and a
 * testing library in to assert on markup would trade a zero-dependency plugin
 * for a lint that a regular expression does just as well — every fact checked
 * below is a syntactic property of the JSX, not of the render result.
 *
 * What these guard against, precisely, is the state the plugin was in before:
 * ten form controls with no accessible name at all, five column headers whose
 * sort handler sat on a bare `<th>` (no role, no keyboard access, no
 * `aria-sort`), a `<tr onClick>` that expanded a document's issues and that no
 * keyboard user could reach, and two tabs whose selected state existed only as
 * a colour.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (relative: string): string => readFileSync(join(srcRoot, relative), 'utf-8')

const DASHBOARD = read('components/SpellCheckDashboard.tsx')
const ISSUE_CARD = read('components/IssueCard.tsx')
const FIELD = read('components/SpellCheckField.tsx')
const SCORE_CELL = read('components/SpellCheckScoreCell.tsx')

/**
 * Return the text of every opening tag of `tagName` in `source`.
 *
 * Naive splitting on `>` does not work here: JSX attributes are full
 * expressions (`onClick={() => handleSort('title')}`) and contain both `>` and
 * quotes. Track brace depth and string state so the scan stops on the `>` that
 * actually closes the tag.
 */
function openingTags(source: string, tagName: string): string[] {
  const tags: string[] = []
  const needle = `<${tagName}`
  let from = 0

  for (;;) {
    const start = source.indexOf(needle, from)
    if (start === -1) break
    const after = source[start + needle.length]
    // `<input` must not match `<inputSomething`.
    if (after !== undefined && /[A-Za-z0-9_]/.test(after)) {
      from = start + needle.length
      continue
    }

    let depth = 0
    let quote: string | null = null
    let i = start + needle.length
    for (; i < source.length; i++) {
      const c = source[i]!
      if (quote) {
        if (c === quote) quote = null
        continue
      }
      // Line comments live inside these tags and contain both `>` and quotes.
      if (c === '/' && source[i + 1] === '/') {
        const eol = source.indexOf('\n', i)
        i = eol === -1 ? source.length : eol
        continue
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '{') { depth++; continue }
      if (c === '}') { depth--; continue }
      if (c === '>' && depth === 0) break
    }
    tags.push(source.slice(start, i + 1))
    from = i + 1
  }

  return tags
}

const NAMED = /aria-label=|aria-labelledby=/

describe('form controls carry an accessible name', () => {
  const files: Array<[string, string, number]> = [
    ['SpellCheckDashboard.tsx', DASHBOARD, 8],
    ['IssueCard.tsx', ISSUE_CARD, 2],
  ]

  for (const [name, source, expected] of files) {
    for (const tag of ['input', 'select', 'textarea']) {
      it(`${name}: every <${tag}> is named`, () => {
        const unnamed = openingTags(source, tag).filter((t) => !NAMED.test(t))
        expect(unnamed, `unnamed <${tag}> in ${name}:\n${unnamed.join('\n---\n')}`).toEqual([])
      })
    }

    it(`${name} still declares the ${expected} controls this covers`, () => {
      // A guard against the test passing because the controls were deleted.
      const total =
        openingTags(source, 'input').length +
        openingTags(source, 'select').length +
        openingTags(source, 'textarea').length
      expect(total).toBe(expected)
    })
  }
})

describe('sortable column headers are real controls', () => {
  it('no <th> carries the sort handler directly', () => {
    const withHandler = openingTags(DASHBOARD, 'th').filter((t) => t.includes('onClick'))
    expect(withHandler, `clickable <th> left in place:\n${withHandler.join('\n')}`).toEqual([])
  })

  it('every sortable header exposes aria-sort', () => {
    const sortable = openingTags(DASHBOARD, 'th').filter((t) => t.includes('aria-sort'))
    // Document, Score, Problèmes, Mots, Vérifié — Collection and Lisibilité are
    // not sortable and must NOT claim to be.
    expect(sortable).toHaveLength(5)
  })

  it('each sort trigger is a button', () => {
    const sortButtons = openingTags(DASHBOARD, 'button').filter((t) =>
      t.includes('handleSort('),
    )
    expect(sortButtons).toHaveLength(5)
    for (const tag of sortButtons) expect(tag).toContain('type="button"')
  })
})

describe('the issue list is reachable without a mouse', () => {
  it('no table row carries a click handler', () => {
    const clickableRows = openingTags(DASHBOARD, 'tr').filter((t) => t.includes('onClick'))
    expect(clickableRows, `clickable <tr> left in place:\n${clickableRows.join('\n')}`).toEqual([])
  })

  it('no row is faked into a control with a role', () => {
    // The tempting wrong fix: `<tr role="button" tabIndex={0}>`. It destroys the
    // row's association with its column headers for screen readers.
    const rows = openingTags(DASHBOARD, 'tr')
    for (const tag of rows) {
      expect(tag).not.toContain('role=')
      expect(tag).not.toContain('tabIndex')
    }
  })

  it('the disclosure trigger is a button that reports its state', () => {
    const disclosure = openingTags(DASHBOARD, 'button').filter((t) =>
      t.includes('setExpandedId('),
    )
    expect(disclosure).toHaveLength(1)
    expect(disclosure[0]).toContain('aria-expanded')
  })
})

describe('tabs announce which one is selected', () => {
  it('declares a tablist with two tabs and two panels', () => {
    // Counted on the tags themselves, not on the raw text: the surrounding
    // comments quote these role names too.
    const divs = openingTags(DASHBOARD, 'div')
    expect(divs.filter((t) => t.includes('role="tablist"'))).toHaveLength(1)
    expect(divs.filter((t) => t.includes('role="tabpanel"'))).toHaveLength(2)
    expect(
      openingTags(DASHBOARD, 'button').filter((t) => t.includes('role="tab"')),
    ).toHaveLength(2)
  })

  it('each tab reports aria-selected and points at its panel', () => {
    const tabs = openingTags(DASHBOARD, 'button').filter((t) => t.includes('role="tab"'))
    expect(tabs).toHaveLength(2)
    for (const tag of tabs) {
      expect(tag).toContain('aria-selected=')
      expect(tag).toContain('aria-controls=')
      // Roving tabindex: with role="tab", exactly one tab belongs to the tab
      // sequence and the arrows move between them.
      expect(tag).toContain('tabIndex=')
    }
  })

  it('ids come from useId, never hardcoded', () => {
    // Hardcoded ids collide as soon as the dashboard is mounted twice, which is
    // exactly what breaks the association these attributes create.
    expect(DASHBOARD).toContain('useId')
    expect(DASHBOARD).not.toMatch(/id="[a-z-]+"/)
  })
})

describe('the focus indicator is never removed', () => {
  // The browser's default focus ring is conformant; suppressing it is the bug.
  // `all: unset` is the subtle way to do it: it resets `outline-style` to
  // `none` as an author declaration, which outranks the UA :focus-visible rule.
  const sources: Array<[string, string]> = [
    ['SpellCheckDashboard.tsx', DASHBOARD],
    ['IssueCard.tsx', ISSUE_CARD],
    ['SpellCheckField.tsx', FIELD],
    ['SpellCheckScoreCell.tsx', SCORE_CELL],
    ['ErrorBoundary.tsx', read('components/ErrorBoundary.tsx')],
  ]

  for (const [name, source] of sources) {
    it(`${name} neither hides the outline nor unsets every property`, () => {
      expect(source).not.toMatch(/outline\s*:\s*['"]none['"]/)
      expect(source).not.toMatch(/all\s*:\s*['"]unset['"]/)
    })
  }
})

describe('injected components are wrapped in an error boundary', () => {
  it('the list-view cell degrades silently rather than blanking the table', () => {
    expect(SCORE_CELL).toContain('AdminErrorBoundary')
    expect(SCORE_CELL).toContain('fallback={null}')
    // The exported symbol must be the wrapper, not the raw component.
    expect(SCORE_CELL).toMatch(/export const SpellCheckScoreCell[^\n]*\n\s*<AdminErrorBoundary/)
  })

  it('the sidebar field degrades silently too', () => {
    expect(FIELD).toContain('AdminErrorBoundary')
    expect(FIELD).toContain('fallback={null}')
    expect(FIELD).toMatch(/export const SpellCheckField[^\n]*\n\s*<AdminErrorBoundary/)
  })

  it('the full-page view keeps a visible fallback', () => {
    const view = read('views/SpellCheckView.tsx')
    expect(view).toContain('<AdminErrorBoundary viewName="SpellCheckView">')
    expect(view).not.toContain('fallback={null}')
    // It must come through the client subpath: a relative import would inline a
    // stateful class into the server bundle and break the RSC boundary.
    expect(view).toContain("from '@consilioweb/payload-spellcheck/client'")
    expect(view).not.toMatch(/from '\.\.\/components\/ErrorBoundary/)
  })

  it('the boundary is emitted by the client build', () => {
    // `bundle: false` on that tsup entry: a component missing from the entry
    // list leaves a dangling import in the published package.
    const tsup = readFileSync(join(srcRoot, '..', 'tsup.config.ts'), 'utf-8')
    expect(tsup).toContain("'src/components/ErrorBoundary.tsx'")
  })
})
