/**
 * SpellCheckDashboard — main admin dashboard for bulk spellcheck.
 * Shows table of all documents with scores, issues, and scan controls.
 */

'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { IssueCard } from './IssueCard.js'
import type { SpellCheckIssue, SpellCheckResult } from '../types.js'

interface StoredResult {
  id: string | number
  docId: string
  collection: string
  title: string
  slug: string
  score: number
  issueCount: number
  wordCount: number
  issues: SpellCheckIssue[]
  lastChecked: string
}

const styles = {
  container: {
    padding: '24px',
    maxWidth: '1200px',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  } as React.CSSProperties,
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: 'var(--theme-text)',
    margin: 0,
  } as React.CSSProperties,
  description: {
    fontSize: '14px',
    color: 'var(--theme-elevation-500)',
    marginTop: '4px',
  } as React.CSSProperties,
  scanBtn: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '4px',
    backgroundColor: 'var(--theme-elevation-900)',
    color: 'var(--theme-elevation-0)',
    cursor: 'pointer',
  } as React.CSSProperties,
  scanBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  } as React.CSSProperties,
  summaryCard: {
    padding: '16px',
    borderRadius: '6px',
    backgroundColor: 'var(--theme-elevation-50)',
    border: '1px solid var(--theme-elevation-150)',
  } as React.CSSProperties,
  summaryLabel: {
    fontSize: '12px',
    color: 'var(--theme-elevation-500)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '4px',
  } as React.CSSProperties,
  summaryValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: 'var(--theme-text)',
  } as React.CSSProperties,
  progress: {
    padding: '12px 16px',
    marginBottom: '16px',
    borderRadius: '4px',
    backgroundColor: 'var(--theme-elevation-50)',
    border: '1px solid var(--theme-elevation-150)',
    fontSize: '13px',
    color: 'var(--theme-text)',
  } as React.CSSProperties,
  progressBar: {
    height: '4px',
    backgroundColor: 'var(--theme-elevation-150)',
    borderRadius: '2px',
    marginTop: '8px',
    overflow: 'hidden' as const,
  } as React.CSSProperties,
  progressFill: (pct: number) => ({
    height: '100%',
    width: `${pct}%`,
    backgroundColor: 'var(--theme-success-500)',
    borderRadius: '2px',
    transition: 'width 0.3s',
  }) as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '2px solid var(--theme-elevation-200)',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: 'var(--theme-elevation-500)',
    cursor: 'pointer',
  } as React.CSSProperties,
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid var(--theme-elevation-100)',
    verticalAlign: 'middle' as const,
  } as React.CSSProperties,
  tr: {
    cursor: 'pointer',
  } as React.CSSProperties,
  trHover: {
    backgroundColor: 'var(--theme-elevation-50)',
  } as React.CSSProperties,
  scoreBadge: (score: number) => ({
    display: 'inline-block',
    fontSize: '12px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '10px',
    color: '#fff',
    backgroundColor: score >= 95 ? 'var(--theme-success-500)'
      : score >= 80 ? '#f59e0b'
      : 'var(--theme-error-500)',
  }) as React.CSSProperties,
  expandedRow: {
    padding: '16px',
    backgroundColor: 'var(--theme-elevation-50)',
    borderBottom: '1px solid var(--theme-elevation-150)',
  } as React.CSSProperties,
  empty: {
    textAlign: 'center' as const,
    padding: '40px 0',
    color: 'var(--theme-elevation-500)',
    fontSize: '14px',
  } as React.CSSProperties,
  link: {
    color: 'var(--theme-text)',
    textDecoration: 'none',
    fontWeight: 500,
  } as React.CSSProperties,
}

type SortKey = 'title' | 'score' | 'issueCount' | 'wordCount' | 'lastChecked'
type SortDir = 'asc' | 'desc'

export const SpellCheckDashboard: React.FC = () => {
  const [results, setResults] = useState<StoredResult[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState('')
  const [expandedId, setExpandedId] = useState<string | number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [hoveredRow, setHoveredRow] = useState<string | number | null>(null)

  // Load stored results
  const loadResults = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/spellcheck-results?limit=0&sort=-lastChecked')
      const data = await res.json()
      setResults(data.docs || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadResults() }, [loadResults])

  // Bulk scan
  const handleScan = useCallback(async () => {
    if (scanning) return
    setScanning(true)
    setScanProgress('Analyse en cours...')

    try {
      const res = await fetch('/api/spellcheck/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (res.ok) {
        const data = await res.json()
        setScanProgress(
          `Terminé — ${data.totalDocuments} documents, ${data.totalIssues} problèmes, score moyen ${data.averageScore}`,
        )
        await loadResults()
      } else {
        setScanProgress('Erreur lors de l\'analyse')
      }
    } catch {
      setScanProgress('Erreur réseau')
    } finally {
      setScanning(false)
    }
  }, [scanning, loadResults])

  // Fix issue
  const handleFix = useCallback(async (
    docId: string,
    collection: string,
    original: string,
    replacement: string,
  ) => {
    try {
      const res = await fetch('/api/spellcheck/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, collection, original, replacement }),
      })
      if (res.ok) {
        // Reload to reflect fix
        await loadResults()
      }
    } catch {
      // ignore
    }
  }, [loadResults])

  // Sort
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'score' ? 'asc' : 'desc')
    }
  }

  const sortedResults = [...results].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortKey) {
      case 'title': return dir * (a.title || '').localeCompare(b.title || '')
      case 'score': return dir * (a.score - b.score)
      case 'issueCount': return dir * (a.issueCount - b.issueCount)
      case 'wordCount': return dir * ((a.wordCount || 0) - (b.wordCount || 0))
      case 'lastChecked': return dir * (new Date(a.lastChecked).getTime() - new Date(b.lastChecked).getTime())
      default: return 0
    }
  })

  const totalIssues = results.reduce((sum, r) => sum + r.issueCount, 0)
  const avgScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 0

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Correcteur orthographique</h1>
          <p style={styles.description}>
            Analyse orthographique et grammaticale du contenu via LanguageTool
          </p>
        </div>
        <button
          type="button"
          style={{
            ...styles.scanBtn,
            ...(scanning ? styles.scanBtnDisabled : {}),
          }}
          onClick={handleScan}
          disabled={scanning}
        >
          {scanning ? 'Analyse...' : 'Scanner tout'}
        </button>
      </div>

      {scanProgress && (
        <div style={styles.progress}>{scanProgress}</div>
      )}

      {results.length > 0 && (
        <div style={styles.summary}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Documents</div>
            <div style={styles.summaryValue}>{results.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Score moyen</div>
            <div style={styles.summaryValue}>{avgScore}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Problèmes</div>
            <div style={styles.summaryValue}>{totalIssues}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Sans erreurs</div>
            <div style={styles.summaryValue}>
              {results.filter((r) => r.issueCount === 0).length}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={styles.empty}>Chargement...</div>
      ) : results.length === 0 ? (
        <div style={styles.empty}>
          Aucun résultat. Cliquez sur "Scanner tout" pour analyser le contenu.
        </div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th} onClick={() => handleSort('title')}>
                Document{sortIndicator('title')}
              </th>
              <th style={styles.th}>Collection</th>
              <th style={styles.th} onClick={() => handleSort('score')}>
                Score{sortIndicator('score')}
              </th>
              <th style={styles.th} onClick={() => handleSort('issueCount')}>
                Problèmes{sortIndicator('issueCount')}
              </th>
              <th style={styles.th} onClick={() => handleSort('wordCount')}>
                Mots{sortIndicator('wordCount')}
              </th>
              <th style={styles.th} onClick={() => handleSort('lastChecked')}>
                Vérifié{sortIndicator('lastChecked')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((r) => (
              <React.Fragment key={`${r.collection}-${r.docId}`}>
                <tr
                  style={{
                    ...styles.tr,
                    ...(hoveredRow === r.id ? styles.trHover : {}),
                  }}
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  onMouseEnter={() => setHoveredRow(r.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td style={styles.td}>
                    <a
                      href={`/admin/collections/${r.collection}/${r.docId}`}
                      style={styles.link}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.title || r.slug || r.docId}
                    </a>
                  </td>
                  <td style={styles.td}>{r.collection}</td>
                  <td style={styles.td}>
                    <span style={styles.scoreBadge(r.score)}>{r.score}</span>
                  </td>
                  <td style={styles.td}>{r.issueCount}</td>
                  <td style={styles.td}>{r.wordCount || '—'}</td>
                  <td style={styles.td}>
                    {r.lastChecked
                      ? new Date(r.lastChecked).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                </tr>
                {expandedId === r.id && r.issues && r.issues.length > 0 && (
                  <tr>
                    <td colSpan={6} style={styles.expandedRow}>
                      {(r.issues as SpellCheckIssue[]).map((issue, i) => (
                        <IssueCard
                          key={`${issue.ruleId}-${issue.offset}-${i}`}
                          issue={issue}
                          onFix={(original, replacement) =>
                            handleFix(r.docId, r.collection, original, replacement)
                          }
                        />
                      ))}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default SpellCheckDashboard
