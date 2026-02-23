/**
 * IssueCard — displays a single spellcheck issue with context, suggestion, and fix button.
 */

import React, { useState } from 'react'
import type { SpellCheckIssue } from '../types.js'

interface IssueCardProps {
  issue: SpellCheckIssue
  onFix?: (original: string, replacement: string, offset: number, length: number) => void
  onIgnore?: (ruleId: string) => void
  onAddToDict?: (word: string) => void
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
  diff: {
    padding: '8px 10px',
    borderRadius: '3px',
    backgroundColor: 'var(--theme-elevation-100)',
    marginBottom: '8px',
    fontSize: '13px',
    lineHeight: '1.6',
    fontFamily: 'monospace',
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  diffBefore: {
    textDecoration: 'line-through',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: 'var(--theme-error-500)',
    padding: '1px 3px',
    borderRadius: '2px',
  } as React.CSSProperties,
  diffAfter: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    color: 'var(--theme-success-500)',
    fontWeight: 600,
    padding: '1px 3px',
    borderRadius: '2px',
  } as React.CSSProperties,
  diffArrow: {
    display: 'inline-block',
    margin: '0 6px',
    color: 'var(--theme-elevation-400)',
    fontSize: '12px',
  } as React.CSSProperties,
}

export const IssueCard: React.FC<IssueCardProps> = ({
  issue,
  onFix,
  onIgnore,
  onAddToDict,
  isFixed = false,
}) => {
  const [showDiff, setShowDiff] = useState(false)
  const [selectedReplacement, setSelectedReplacement] = useState(0)
  const [manualEdit, setManualEdit] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [addedToDict, setAddedToDict] = useState(false)

  // Use contextOffset from LanguageTool for accurate positioning
  const getContextIdx = (ctx: string, original: string): number => {
    // Use the stored contextOffset if available (accurate position from LanguageTool)
    if (typeof issue.contextOffset === 'number' && issue.contextOffset >= 0) {
      return issue.contextOffset
    }
    // Fallback to indexOf (may find wrong occurrence for short strings)
    return ctx.indexOf(original)
  }

  const highlightContext = (ctx: string, original: string) => {
    const idx = getContextIdx(ctx, original)
    if (!original || idx < 0) return ctx
    return (
      <>
        {ctx.slice(0, idx)}
        <span style={styles.original}>{original}</span>
        {ctx.slice(idx + original.length)}
      </>
    )
  }

  const renderDiff = (ctx: string, original: string, replacement: string) => {
    const idx = getContextIdx(ctx, original)
    if (!original || idx < 0) {
      return (
        <div style={styles.diff}>
          <span style={styles.diffBefore}>{original}</span>
          <span style={styles.diffArrow}>→</span>
          <span style={styles.diffAfter}>{replacement}</span>
        </div>
      )
    }
    return (
      <div style={styles.diff}>
        <div style={{ marginBottom: '4px', color: 'var(--theme-elevation-400)', fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
          Avant / Après
        </div>
        <div>
          {ctx.slice(0, idx)}
          <span style={styles.diffBefore}>{original}</span>
          {ctx.slice(idx + original.length)}
        </div>
        <div style={{ marginTop: '4px' }}>
          {ctx.slice(0, idx)}
          <span style={styles.diffAfter}>{replacement}</span>
          {ctx.slice(idx + original.length)}
        </div>
      </div>
    )
  }

  const currentReplacement = manualEdit && manualValue
    ? manualValue
    : issue.replacements[selectedReplacement] || ''

  return (
    <div style={{ ...styles.card, ...(isFixed ? styles.fixed : {}) }}>
      <div style={styles.header}>
        <div style={styles.message}>{issue.message}</div>
        <span style={styles.badge}>
          {issue.source === 'claude' ? 'IA' : issue.category}
        </span>
      </div>

      {/* Before/After diff view */}
      {showDiff && issue.context && currentReplacement ? (
        renderDiff(issue.context, issue.original, currentReplacement)
      ) : issue.context ? (
        <div style={styles.context}>
          {highlightContext(issue.context, issue.original)}
        </div>
      ) : null}

      {/* Suggestion or manual edit */}
      {!manualEdit && issue.replacements.length > 0 && (
        <div style={styles.suggestion}>
          <span style={styles.suggestionLabel}>Suggestion :</span>
          {issue.replacements.length > 1 ? (
            <select
              value={selectedReplacement}
              onChange={(e) => setSelectedReplacement(Number(e.target.value))}
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--theme-success-500)',
                border: '1px solid var(--theme-elevation-200)',
                borderRadius: '3px',
                padding: '2px 4px',
                backgroundColor: 'var(--theme-elevation-0)',
              }}
            >
              {issue.replacements.map((r, i) => (
                <option key={i} value={i}>{r}</option>
              ))}
            </select>
          ) : (
            <span style={styles.suggestionText}>{currentReplacement}</span>
          )}
        </div>
      )}

      {/* Manual edit input */}
      {manualEdit && !isFixed && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', color: 'var(--theme-elevation-500)', marginBottom: '4px' }}>
            Correction manuelle :
          </div>
          <input
            type="text"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder={issue.original}
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '13px',
              border: '1px solid var(--theme-elevation-200)',
              borderRadius: '3px',
              backgroundColor: 'var(--theme-elevation-0)',
              color: 'var(--theme-text)',
              boxSizing: 'border-box' as const,
            }}
          />
        </div>
      )}

      <div style={styles.actions}>
        {issue.context && currentReplacement && !isFixed && (
          <button
            type="button"
            style={{ ...styles.btn, fontSize: '10px' }}
            onClick={() => setShowDiff(!showDiff)}
          >
            {showDiff ? 'Masquer' : 'Avant/Après'}
          </button>
        )}
        {!isFixed && (
          <button
            type="button"
            style={{ ...styles.btn, fontSize: '10px' }}
            onClick={() => {
              setManualEdit(!manualEdit)
              if (!manualEdit) setManualValue(issue.original)
            }}
          >
            {manualEdit ? 'Suggestion' : 'Manuel'}
          </button>
        )}
        {currentReplacement && onFix && !isFixed && (
          <button
            type="button"
            style={styles.btnFix}
            onClick={() => onFix(issue.original, currentReplacement, issue.offset, issue.length)}
          >
            Corriger
          </button>
        )}
        {onAddToDict && !isFixed && !addedToDict && issue.original && (
          <button
            type="button"
            style={{ ...styles.btn, fontSize: '10px' }}
            onClick={() => {
              onAddToDict(issue.original)
              setAddedToDict(true)
            }}
            title="Ajouter au dictionnaire"
          >
            + Dico
          </button>
        )}
        {addedToDict && (
          <span style={{ fontSize: '11px', color: 'var(--theme-success-500)' }}>
            Ajouté au dico
          </span>
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
            Corrige
          </span>
        )}
      </div>
    </div>
  )
}

export default IssueCard
