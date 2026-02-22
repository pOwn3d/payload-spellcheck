/**
 * SpellCheckField — sidebar field component for the Payload editor.
 * Shows spellcheck score + issues for the current document.
 */

'use client'

import React, { useState, useEffect, useCallback } from 'react'
// @ts-ignore — peer dependency
import { useDocumentInfo } from '@payloadcms/ui'
import { IssueCard } from './IssueCard.js'
import type { SpellCheckIssue, SpellCheckResult } from '../types.js'

const styles = {
  container: {
    padding: '12px 0',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  } as React.CSSProperties,
  title: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--theme-text)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  } as React.CSSProperties,
  scoreBadge: (score: number) => ({
    fontSize: '14px',
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: '12px',
    color: '#fff',
    backgroundColor: score >= 95 ? 'var(--theme-success-500)'
      : score >= 80 ? '#f59e0b'
      : 'var(--theme-error-500)',
  }) as React.CSSProperties,
  checkBtn: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: 600,
    border: '1px solid var(--theme-elevation-200)',
    borderRadius: '4px',
    backgroundColor: 'var(--theme-elevation-0)',
    color: 'var(--theme-text)',
    cursor: 'pointer',
    textAlign: 'center' as const,
    marginBottom: '12px',
  } as React.CSSProperties,
  checkBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  stats: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: 'var(--theme-elevation-500)',
    marginBottom: '12px',
    padding: '6px 8px',
    backgroundColor: 'var(--theme-elevation-50)',
    borderRadius: '4px',
  } as React.CSSProperties,
  issueList: {
    maxHeight: '400px',
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  empty: {
    textAlign: 'center' as const,
    padding: '20px 0',
    fontSize: '13px',
    color: 'var(--theme-elevation-500)',
  } as React.CSSProperties,
  error: {
    padding: '8px 12px',
    fontSize: '12px',
    color: 'var(--theme-error-500)',
    backgroundColor: 'var(--theme-error-100)',
    borderRadius: '4px',
    marginBottom: '12px',
  } as React.CSSProperties,
}

export const SpellCheckField: React.FC = () => {
  const { id, collectionSlug } = useDocumentInfo()
  const [result, setResult] = useState<SpellCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fixedIssues, setFixedIssues] = useState<Set<string>>(new Set())

  // Load existing result on mount
  useEffect(() => {
    if (!id || !collectionSlug) return

    fetch(`/api/spellcheck-results?where[docId][equals]=${id}&where[collection][equals]=${collectionSlug}&limit=1`)
      .then((res) => res.json())
      .then((data) => {
        if (data.docs?.[0]) {
          setResult({
            docId: String(id),
            collection: collectionSlug,
            score: data.docs[0].score,
            issueCount: data.docs[0].issueCount,
            wordCount: data.docs[0].wordCount || 0,
            issues: (data.docs[0].issues || []) as SpellCheckIssue[],
            lastChecked: data.docs[0].lastChecked,
          })
        }
      })
      .catch(() => { /* ignore */ })
  }, [id, collectionSlug])

  const handleCheck = useCallback(async () => {
    if (!id || !collectionSlug || loading) return

    setLoading(true)
    setError(null)
    setFixedIssues(new Set())

    try {
      const res = await fetch('/api/spellcheck/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, collection: collectionSlug }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = (await res.json()) as SpellCheckResult
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id, collectionSlug, loading])

  const handleFix = useCallback(async (original: string, replacement: string) => {
    if (!id || !collectionSlug) return

    try {
      const res = await fetch('/api/spellcheck/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          collection: collectionSlug,
          original,
          replacement,
        }),
      })

      if (res.ok) {
        setFixedIssues((prev) => new Set([...prev, `${original}→${replacement}`]))
      }
    } catch {
      // ignore
    }
  }, [id, collectionSlug])

  const handleIgnore = useCallback((ruleId: string) => {
    if (!result) return
    setResult({
      ...result,
      issues: result.issues.filter((i) => i.ruleId !== ruleId),
      issueCount: result.issues.filter((i) => i.ruleId !== ruleId).length,
    })
  }, [result])

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Orthographe</span>
        {result && (
          <span style={styles.scoreBadge(result.score)}>{result.score}</span>
        )}
      </div>

      <button
        type="button"
        style={{
          ...styles.checkBtn,
          ...(loading ? styles.checkBtnDisabled : {}),
        }}
        onClick={handleCheck}
        disabled={loading}
      >
        {loading ? 'Vérification...' : 'Vérifier'}
      </button>

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <>
          <div style={styles.stats}>
            <span>{result.wordCount} mots</span>
            <span>{result.issueCount} problème{result.issueCount !== 1 ? 's' : ''}</span>
            {result.lastChecked && (
              <span>
                {new Date(result.lastChecked).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>

          {result.issues.length > 0 ? (
            <div style={styles.issueList}>
              {result.issues.map((issue, i) => (
                <IssueCard
                  key={`${issue.ruleId}-${issue.offset}-${i}`}
                  issue={issue}
                  onFix={handleFix}
                  onIgnore={handleIgnore}
                  isFixed={fixedIssues.has(`${issue.original}→${issue.replacements[0]}`)}
                />
              ))}
            </div>
          ) : (
            <div style={styles.empty}>Aucun problème détecté ✓</div>
          )}
        </>
      )}

      {!result && !loading && (
        <div style={styles.empty}>
          Cliquez sur "Vérifier" pour analyser le contenu
        </div>
      )}
    </div>
  )
}

export default SpellCheckField
