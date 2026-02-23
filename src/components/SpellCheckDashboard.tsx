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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filterCollection, setFilterCollection] = useState<string>('')
  const [allDocs, setAllDocs] = useState<Array<{ id: string; collection: string; title: string; slug: string }>>([])
  const [loadingDocs, setLoadingDocs] = useState(true)

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

  // Load all docs from configured collections (pages + posts)
  const loadAllDocs = useCallback(async () => {
    setLoadingDocs(true)
    try {
      const collections = ['pages', 'posts'] // Will be overridden by results
      const docs: typeof allDocs = []
      for (const col of collections) {
        try {
          const res = await fetch(`/api/${col}?limit=0&depth=0&where[_status][equals]=published`)
          const data = await res.json()
          if (data.docs) {
            for (const doc of data.docs) {
              docs.push({
                id: String(doc.id),
                collection: col,
                title: doc.title || doc.slug || String(doc.id),
                slug: doc.slug || '',
              })
            }
          }
        } catch { /* collection might not exist */ }
      }
      setAllDocs(docs)
    } finally {
      setLoadingDocs(false)
    }
  }, [])

  useEffect(() => { loadResults(); loadAllDocs() }, [loadResults, loadAllDocs])

  // Toggle selection
  const toggleSelect = useCallback((docId: string, collection: string) => {
    const key = `${collection}:${docId}`
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    const filtered = filteredMergedDocs
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((d) => `${d.collection}:${d.docId}`)))
    }
  }, [selectedIds.size])

  // Bulk scan (all or selected)
  const handleScan = useCallback(async (onlySelected = false) => {
    if (scanning) return
    setScanning(true)
    setSelectedIds(new Set())

    const idsToScan = onlySelected
      ? [...selectedIds].map((key) => {
          const [collection, id] = key.split(':')
          return { id, collection }
        })
      : undefined

    const label = onlySelected ? `${idsToScan!.length} document(s)` : 'tous les documents'
    setScanProgress(`Analyse de ${label} en cours...`)

    try {
      const res = await fetch('/api/spellcheck/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(idsToScan ? { ids: idsToScan } : {}),
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
  }, [scanning, loadResults, selectedIds])

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

  // Merge all docs with existing results
  type MergedDoc = {
    docId: string
    collection: string
    title: string
    slug: string
    score: number | null
    issueCount: number
    wordCount: number
    issues: SpellCheckIssue[]
    lastChecked: string | null
    resultId: string | number | null
  }

  const mergedDocs: MergedDoc[] = React.useMemo(() => {
    const resultMap = new Map<string, StoredResult>()
    for (const r of results) {
      resultMap.set(`${r.collection}:${r.docId}`, r)
    }
    const seen = new Set<string>()
    const merged: MergedDoc[] = []

    // Add all known docs (from API)
    for (const doc of allDocs) {
      const key = `${doc.collection}:${doc.id}`
      seen.add(key)
      const existing = resultMap.get(key)
      merged.push({
        docId: doc.id,
        collection: doc.collection,
        title: doc.title,
        slug: doc.slug,
        score: existing?.score ?? null,
        issueCount: existing?.issueCount ?? 0,
        wordCount: existing?.wordCount ?? 0,
        issues: (existing?.issues ?? []) as SpellCheckIssue[],
        lastChecked: existing?.lastChecked ?? null,
        resultId: existing?.id ?? null,
      })
    }

    // Add results that weren't in allDocs (e.g. draft or deleted)
    for (const r of results) {
      const key = `${r.collection}:${r.docId}`
      if (!seen.has(key)) {
        merged.push({
          docId: r.docId,
          collection: r.collection,
          title: r.title,
          slug: r.slug,
          score: r.score,
          issueCount: r.issueCount,
          wordCount: r.wordCount,
          issues: r.issues,
          lastChecked: r.lastChecked,
          resultId: r.id,
        })
      }
    }

    return merged
  }, [results, allDocs])

  // Available collections for filter
  const collections = React.useMemo(() => {
    return [...new Set(mergedDocs.map((d) => d.collection))].sort()
  }, [mergedDocs])

  // Filter by collection
  const filteredMergedDocs = React.useMemo(() => {
    return filterCollection
      ? mergedDocs.filter((d) => d.collection === filterCollection)
      : mergedDocs
  }, [mergedDocs, filterCollection])

  // Sort
  const sortedResults = [...filteredMergedDocs].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortKey) {
      case 'title': return dir * (a.title || '').localeCompare(b.title || '')
      case 'score': return dir * ((a.score ?? 101) - (b.score ?? 101))
      case 'issueCount': return dir * (a.issueCount - b.issueCount)
      case 'wordCount': return dir * ((a.wordCount || 0) - (b.wordCount || 0))
      case 'lastChecked': {
        const aTime = a.lastChecked ? new Date(a.lastChecked).getTime() : 0
        const bTime = b.lastChecked ? new Date(b.lastChecked).getTime() : 0
        return dir * (aTime - bTime)
      }
      default: return 0
    }
  })

  const scannedResults = results.filter((r) => !filterCollection || r.collection === filterCollection)
  const totalIssues = scannedResults.reduce((sum, r) => sum + r.issueCount, 0)
  const avgScore = scannedResults.length > 0
    ? Math.round(scannedResults.reduce((sum, r) => sum + r.score, 0) / scannedResults.length)
    : 0

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  // Workaround: toggleSelectAll needs access to filteredMergedDocs
  // Redefine it after filteredMergedDocs is computed
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredMergedDocs.length && filteredMergedDocs.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredMergedDocs.map((d) => `${d.collection}:${d.docId}`)))
    }
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {selectedIds.size > 0 && (
            <button
              type="button"
              style={{
                ...styles.scanBtn,
                backgroundColor: 'var(--theme-success-500)',
                ...(scanning ? styles.scanBtnDisabled : {}),
              }}
              onClick={() => handleScan(true)}
              disabled={scanning}
            >
              {scanning ? 'Analyse...' : `Scanner (${selectedIds.size})`}
            </button>
          )}
          <button
            type="button"
            style={{
              ...styles.scanBtn,
              ...(scanning ? styles.scanBtnDisabled : {}),
            }}
            onClick={() => handleScan(false)}
            disabled={scanning}
          >
            {scanning ? 'Analyse...' : 'Scanner tout'}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' as const }}>
        {collections.length > 1 && (
          <select
            value={filterCollection}
            onChange={(e) => { setFilterCollection(e.target.value); setSelectedIds(new Set()) }}
            style={{
              padding: '6px 10px',
              fontSize: '13px',
              border: '1px solid var(--theme-elevation-200)',
              borderRadius: '4px',
              backgroundColor: 'var(--theme-elevation-0)',
              color: 'var(--theme-text)',
            }}
          >
            <option value="">Toutes les collections</option>
            {collections.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: '12px', color: 'var(--theme-elevation-500)' }}>
          {filteredMergedDocs.length} document(s)
          {selectedIds.size > 0 && ` — ${selectedIds.size} sélectionné(s)`}
        </span>
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

      {(loading && loadingDocs) ? (
        <div style={styles.empty}>Chargement...</div>
      ) : sortedResults.length === 0 ? (
        <div style={styles.empty}>
          Aucun document trouvé. Vérifiez la configuration des collections.
        </div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: '36px' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredMergedDocs.length && filteredMergedDocs.length > 0}
                  onChange={handleToggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
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
            {sortedResults.map((r) => {
              const rowKey = `${r.collection}:${r.docId}`
              const isSelected = selectedIds.has(rowKey)
              return (
                <React.Fragment key={rowKey}>
                  <tr
                    style={{
                      ...styles.tr,
                      ...(hoveredRow === rowKey ? styles.trHover : {}),
                      ...(isSelected ? { backgroundColor: 'var(--theme-elevation-100)' } : {}),
                    }}
                    onClick={() => {
                      if (r.issues && r.issues.length > 0) {
                        setExpandedId(expandedId === rowKey ? null : rowKey)
                      }
                    }}
                    onMouseEnter={() => setHoveredRow(rowKey)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    <td style={styles.td}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(r.docId, r.collection)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
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
                      {r.score !== null ? (
                        <span style={styles.scoreBadge(r.score)}>{r.score}</span>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--theme-elevation-400)' }}>—</span>
                      )}
                    </td>
                    <td style={styles.td}>{r.lastChecked ? r.issueCount : '—'}</td>
                    <td style={styles.td}>{r.wordCount || '—'}</td>
                    <td style={styles.td}>
                      {r.lastChecked
                        ? new Date(r.lastChecked).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                  {expandedId === rowKey && r.issues && r.issues.length > 0 && (
                    <tr>
                      <td colSpan={7} style={styles.expandedRow}>
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
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default SpellCheckDashboard
