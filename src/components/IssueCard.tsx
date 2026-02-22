/**
 * IssueCard — displays a single spellcheck issue with context, suggestion, and fix button.
 */

import React from 'react'
import type { SpellCheckIssue } from '../types.js'

interface IssueCardProps {
  issue: SpellCheckIssue
  onFix?: (original: string, replacement: string) => void
  onIgnore?: (ruleId: string) => void
  isFixed?: boolean
}

const styles = {
  card: {
    border: '1px solid var(--theme-elevation-150)',
    borderRadius: '4px',
    padding: '12px',
    marginBottom: '8px',
    backgroundColor: 'var(--theme-elevation-50)',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
    marginBottom: '8px',
  } as React.CSSProperties,
  message: {
    fontSize: '13px',
    lineHeight: '1.4',
    color: 'var(--theme-text)',
    flex: 1,
  } as React.CSSProperties,
  badge: {
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: '3px',
    backgroundColor: 'var(--theme-elevation-200)',
    color: 'var(--theme-elevation-800)',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  } as React.CSSProperties,
  context: {
    fontSize: '12px',
    color: 'var(--theme-elevation-500)',
    backgroundColor: 'var(--theme-elevation-100)',
    padding: '6px 8px',
    borderRadius: '3px',
    fontFamily: 'monospace',
    marginBottom: '8px',
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  original: {
    textDecoration: 'line-through',
    color: 'var(--theme-error-500)',
    fontWeight: 600,
  } as React.CSSProperties,
  suggestion: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
  } as React.CSSProperties,
  suggestionLabel: {
    fontSize: '11px',
    color: 'var(--theme-elevation-500)',
  } as React.CSSProperties,
  suggestionText: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--theme-success-500)',
  } as React.CSSProperties,
  actions: {
    display: 'flex',
    gap: '6px',
  } as React.CSSProperties,
  btn: {
    fontSize: '11px',
    padding: '4px 10px',
    borderRadius: '3px',
    border: '1px solid var(--theme-elevation-200)',
    backgroundColor: 'var(--theme-elevation-0)',
    color: 'var(--theme-text)',
    cursor: 'pointer',
  } as React.CSSProperties,
  btnFix: {
    fontSize: '11px',
    padding: '4px 10px',
    borderRadius: '3px',
    border: 'none',
    backgroundColor: 'var(--theme-success-500)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  } as React.CSSProperties,
  fixed: {
    opacity: 0.5,
    pointerEvents: 'none' as const,
  } as React.CSSProperties,
}

export const IssueCard: React.FC<IssueCardProps> = ({
  issue,
  onFix,
  onIgnore,
  isFixed = false,
}) => {
  const highlightContext = (ctx: string, original: string) => {
    if (!original || !ctx.includes(original)) return ctx
    const idx = ctx.indexOf(original)
    return (
      <>
        {ctx.slice(0, idx)}
        <span style={styles.original}>{original}</span>
        {ctx.slice(idx + original.length)}
      </>
    )
  }

  return (
    <div style={{ ...styles.card, ...(isFixed ? styles.fixed : {}) }}>
      <div style={styles.header}>
        <div style={styles.message}>{issue.message}</div>
        <span style={styles.badge}>
          {issue.source === 'claude' ? 'IA' : issue.category}
        </span>
      </div>

      {issue.context && (
        <div style={styles.context}>
          {highlightContext(issue.context, issue.original)}
        </div>
      )}

      {issue.replacements.length > 0 && (
        <div style={styles.suggestion}>
          <span style={styles.suggestionLabel}>→</span>
          <span style={styles.suggestionText}>{issue.replacements[0]}</span>
          {issue.replacements.length > 1 && (
            <span style={styles.suggestionLabel}>
              (+{issue.replacements.length - 1})
            </span>
          )}
        </div>
      )}

      <div style={styles.actions}>
        {issue.replacements.length > 0 && onFix && !isFixed && (
          <button
            type="button"
            style={styles.btnFix}
            onClick={() => onFix(issue.original, issue.replacements[0])}
          >
            Corriger
          </button>
        )}
        {onIgnore && !isFixed && (
          <button
            type="button"
            style={styles.btn}
            onClick={() => onIgnore(issue.ruleId)}
          >
            Ignorer
          </button>
        )}
        {isFixed && (
          <span style={{ fontSize: '11px', color: 'var(--theme-success-500)' }}>
            ✓ Corrigé
          </span>
        )}
      </div>
    </div>
  )
}

export default IssueCard
