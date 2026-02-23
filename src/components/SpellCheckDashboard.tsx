/**
 * SpellCheckDashboard — main admin dashboard for bulk spellcheck.
 * Tab 1: Results table with scores, issues, and scan controls.
 * Tab 2: Dynamic dictionary management (add/remove/import/export).
 */

'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
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

interface DictionaryWord {
  id: string
  word: string
  addedBy?: { id: string; email?: string; name?: string } | string | null
  createdAt?: string
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
  // Tab styles
  tabs: {
    display: 'flex',
    gap: '0',
    marginBottom: '24px',
    borderBottom: '2px solid var(--theme-elevation-150)',
  } as React.CSSProperties,
  tab: (active: boolean) => ({
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--theme-text)' : 'var(--theme-elevation-500)',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid var(--theme-text)' : '2px solid transparent',
    marginBottom: '-2px',
    cursor: 'pointer',
  }) as React.CSSProperties,
}

type SortKey = 'title' | 'score' | 'issueCount' | 'wordCount' | 'lastChecked'
type SortDir = 'asc' | 'desc'
type TabId = 'results' | 'dictionary'

export const SpellCheckDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('results')
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

  // Dictionary state
  const [dictWords, setDictWords] = useState<DictionaryWord[]>([])
  const [dictLoading, setDictLoading] = useState(false)
  const [dictSearch, setDictSearch] = useState('')
  const [dictInput, setDictInput] = useState('')
  const [dictSelectedIds, setDictSelectedIds] = useState<Set<string>>(new Set())
  const [dictToast, setDictToast] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  // Ref for stable access to results in callbacks
  const resultsRef = useRef(results)
  resultsRef.current = results

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
      const collections = ['pages', 'posts']
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

  // Load dictionary words
  const loadDictionary = useCallback(async () => {
    setDictLoading(true)
    try {
      const res = await fetch('/api/spellcheck/dictionary')
      const data = await res.json()
      setDictWords(data.words || [])
    } catch {
      // ignore
    } finally {
      setDictLoading(false)
    }
  }, [])

  useEffect(() => { loadResults(); loadAllDocs() }, [loadResults, loadAllDocs])

  // Load dictionary when switching to tab
  useEffect(() => {
    if (activeTab === 'dictionary') {
      loadDictionary()
    }
  }, [activeTab, loadDictionary])

  // Toast auto-dismiss
  useEffect(() => {
    if (!dictToast) return
    const t = setTimeout(() => setDictToast(''), 3000)
    return () => clearTimeout(t)
  }, [dictToast])

  // Toggle selection
  const toggleSelect = useCallback((docId: string, collection: string) => {
    const key = `${collection}:${docId}`
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }, [])

  const [scanCurrent, setScanCurrent] = useState(0)
  const [scanTotal, setScanTotal] = useState(0)
  const [scanCurrentDoc, setScanCurrentDoc] = useState('')

  // Poll scan status every 2 seconds while scanning
  useEffect(() => {
    if (!scanning) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/spellcheck/status')
        if (!res.ok) return
        const data = await res.json()

        if (data.status === 'running') {
          setScanCurrent(data.current || 0)
          setScanTotal(data.total || 0)
          setScanCurrentDoc(data.currentDoc || '')
          setScanProgress(
            `Analyse en cours... ${data.current}/${data.total} — ${data.currentDoc || ''}`,
          )
        } else if (data.status === 'completed') {
          setScanProgress(
            `Terminé — ${data.totalDocuments} documents, ${data.totalIssues} problèmes, score moyen ${data.averageScore}`,
          )
          setScanning(false)
          setScanCurrent(0)
          setScanTotal(0)
          setScanCurrentDoc('')
          loadResults()
        } else if (data.status === 'error') {
          setScanProgress(`Erreur : ${data.error || 'Erreur inconnue'}`)
          setScanning(false)
          loadResults()
        } else if (data.status === 'idle') {
          // Job was auto-reset or never started
          setScanProgress('')
          setScanning(false)
          loadResults()
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [scanning, loadResults])

  // Check if a scan is already running on mount
  useEffect(() => {
    fetch('/api/spellcheck/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'running') {
          setScanning(true)
          setScanCurrent(data.current || 0)
          setScanTotal(data.total || 0)
          setScanCurrentDoc(data.currentDoc || '')
          setScanProgress(
            `Analyse en cours... ${data.current}/${data.total} — ${data.currentDoc || ''}`,
          )
        }
      })
      .catch(() => { /* ignore */ })
  }, [])

  // Force-reset a stuck scan
  const handleForceReset = useCallback(async () => {
    try {
      const res = await fetch('/api/spellcheck/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      if (res.ok) {
        setScanning(true)
        setScanCurrent(0)
        setScanTotal(0)
        setScanProgress('Scan précédent réinitialisé, redémarrage...')
      }
    } catch {
      setScanProgress('Erreur réseau')
    }
  }, [])

  // Bulk scan (all or selected)
  const handleScan = useCallback(async (onlySelected = false) => {
    if (scanning) return
    setScanning(true)
    setSelectedIds(new Set())
    setScanCurrent(0)
    setScanTotal(0)
    setScanProgress('Démarrage de l\'analyse...')

    const idsToScan = onlySelected
      ? [...selectedIds].map((key) => {
          const [collection, id] = key.split(':')
          return { id, collection }
        })
      : undefined

    try {
      const res = await fetch('/api/spellcheck/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(idsToScan ? { ids: idsToScan } : {}),
      })

      if (res.ok) {
        setScanProgress('Analyse en cours... 0/? — démarrage')
      } else if (res.status === 409) {
        setScanProgress('Une analyse est déjà en cours...')
        // Offer force reset after 409
        setScanning(false)
      } else {
        setScanProgress('Erreur lors du lancement de l\'analyse')
        setScanning(false)
      }
    } catch {
      setScanProgress('Erreur réseau')
      setScanning(false)
    }
  }, [scanning, selectedIds])

  // Remove an issue from stored results (optimistic UI + persist to DB)
  const removeIssueFromResults = useCallback((
    docId: string,
    collection: string,
    issueIdentifier: { offset?: number; original?: string; ruleId?: string },
  ) => {
    const target = resultsRef.current.find(
      (r) => r.docId === docId && r.collection === collection,
    )
    if (!target) return

    const updatedIssues = target.issues.filter((issue) => {
      if (typeof issueIdentifier.offset !== 'number') return true
      if (issue.offset !== issueIdentifier.offset) return true
      // Same offset — confirm with secondary field if available
      if (issueIdentifier.original && issue.original !== issueIdentifier.original) return true
      if (issueIdentifier.ruleId && issue.ruleId !== issueIdentifier.ruleId) return true
      return false // Remove this issue
    })

    const updatedCount = updatedIssues.length
    const updatedScore = target.wordCount > 0
      ? Math.max(0, Math.round(100 - (updatedCount / target.wordCount * 1000)))
      : target.score

    // Optimistic UI update
    setResults((prev) => prev.map((r) => {
      if (r.id !== target.id) return r
      return { ...r, issues: updatedIssues, issueCount: updatedCount, score: updatedScore }
    }))

    // Persist to DB (fire-and-forget)
    if (target.id) {
      fetch(`/api/spellcheck-results/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issues: updatedIssues, issueCount: updatedCount, score: updatedScore }),
      }).catch(() => {})
    }
  }, [])

  // Fix issue — apply correction then remove from UI + DB
  const handleFix = useCallback(async (
    docId: string,
    collection: string,
    original: string,
    replacement: string,
    offset?: number,
    length?: number,
  ) => {
    try {
      const res = await fetch('/api/spellcheck/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, collection, original, replacement, offset, length }),
      })
      if (res.ok) {
        removeIssueFromResults(docId, collection, { offset, original })
      }
    } catch {
      // ignore
    }
  }, [removeIssueFromResults])

  // Ignore issue — remove from UI + persist in DB + add to ignoredIssues
  const handleIgnore = useCallback((
    docId: string,
    collection: string,
    ruleId: string,
    offset: number,
    original: string,
  ) => {
    removeIssueFromResults(docId, collection, { offset, ruleId })

    // Persist to ignoredIssues (so it survives rescans)
    const target = resultsRef.current.find(
      (r) => r.docId === docId && r.collection === collection,
    )
    if (target?.id) {
      // Load current ignoredIssues, append, and save
      fetch(`/api/spellcheck-results/${target.id}?depth=0`)
        .then((res) => res.json())
        .then((data) => {
          const existing: Array<{ ruleId: string; original: string }> = Array.isArray(data.ignoredIssues) ? data.ignoredIssues : []
          const alreadyIgnored = existing.some((e) => e.ruleId === ruleId && e.original === original)
          if (!alreadyIgnored) {
            fetch(`/api/spellcheck-results/${target.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ignoredIssues: [...existing, { ruleId, original }] }),
            }).catch(() => {})
          }
        })
        .catch(() => {})
    }
  }, [removeIssueFromResults])

  // Add word to dictionary (from IssueCard)
  const handleAddToDict = useCallback(async (word: string) => {
    try {
      const res = await fetch('/api/spellcheck/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word }),
      })
      if (res.ok) {
        setDictToast(`"${word}" ajouté au dictionnaire`)
        // Reload dictionary if on that tab
        if (activeTab === 'dictionary') loadDictionary()
      }
    } catch {
      // ignore
    }
  }, [activeTab, loadDictionary])

  // Dictionary: add word(s)
  const handleDictAdd = useCallback(async () => {
    if (!dictInput.trim()) return
    // Support comma, semicolon, or newline separated
    const words = dictInput.split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean)
    if (words.length === 0) return

    try {
      const res = await fetch('/api/spellcheck/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      })
      if (res.ok) {
        const data = await res.json()
        setDictToast(`${data.count} mot(s) ajouté(s)${data.skipped.length > 0 ? `, ${data.skipped.length} doublon(s)` : ''}`)
        setDictInput('')
        loadDictionary()
      }
    } catch {
      setDictToast('Erreur lors de l\'ajout')
    }
  }, [dictInput, loadDictionary])

  // Dictionary: delete word(s)
  const handleDictDelete = useCallback(async (ids: string[]) => {
    try {
      const res = await fetch('/api/spellcheck/dictionary', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (res.ok) {
        const data = await res.json()
        setDictToast(`${data.deleted} mot(s) supprimé(s)`)
        setDictSelectedIds(new Set())
        loadDictionary()
      }
    } catch {
      setDictToast('Erreur lors de la suppression')
    }
  }, [loadDictionary])

  // Dictionary: import
  const handleDictImport = useCallback(async () => {
    const words = importText.split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean)
    if (words.length === 0) return

    try {
      const res = await fetch('/api/spellcheck/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      })
      if (res.ok) {
        const data = await res.json()
        setDictToast(`${data.count} mot(s) importé(s)${data.skipped.length > 0 ? `, ${data.skipped.length} doublon(s)` : ''}`)
        setImportText('')
        setShowImport(false)
        loadDictionary()
      }
    } catch {
      setDictToast('Erreur lors de l\'import')
    }
  }, [importText, loadDictionary])

  // Dictionary: export
  const handleDictExport = useCallback(() => {
    const content = dictWords.map((w) => w.word).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'spellcheck-dictionary.txt'
    a.click()
    URL.revokeObjectURL(url)
    setDictToast('Dictionnaire exporté')
  }, [dictWords])

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

  const collections = React.useMemo(() => {
    return [...new Set(mergedDocs.map((d) => d.collection))].sort()
  }, [mergedDocs])

  const filteredMergedDocs = React.useMemo(() => {
    return filterCollection
      ? mergedDocs.filter((d) => d.collection === filterCollection)
      : mergedDocs
  }, [mergedDocs, filterCollection])

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

  // Docs with errors (issueCount > 0 and already scanned)
  const docsWithErrors = React.useMemo(() => {
    return filteredMergedDocs.filter((d) => d.issueCount > 0 && d.lastChecked)
  }, [filteredMergedDocs])

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredMergedDocs.length && filteredMergedDocs.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredMergedDocs.map((d) => `${d.collection}:${d.docId}`)))
    }
  }

  // Select only docs with errors and scan them
  const handleScanErrors = useCallback(() => {
    if (scanning || docsWithErrors.length === 0) return
    const errorIds = new Set(docsWithErrors.map((d) => `${d.collection}:${d.docId}`))
    setSelectedIds(errorIds)
    // Need to trigger scan after state update — use setTimeout
    setTimeout(() => {
      setScanning(true)
      setScanCurrent(0)
      setScanTotal(0)
      setScanProgress('Démarrage de l\'analyse des pages avec erreurs...')

      const idsToScan = docsWithErrors.map((d) => ({ id: d.docId, collection: d.collection }))

      fetch('/api/spellcheck/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToScan }),
      })
        .then((res) => {
          if (res.ok) {
            setScanProgress(`Analyse en cours... 0/${idsToScan.length} — démarrage`)
          } else if (res.status === 409) {
            setScanProgress('Une analyse est déjà en cours...')
          } else {
            setScanProgress('Erreur lors du lancement')
            setScanning(false)
          }
        })
        .catch(() => {
          setScanProgress('Erreur réseau')
          setScanning(false)
        })
    }, 0)
  }, [scanning, docsWithErrors])

  // Dictionary: filtered words
  const filteredDictWords = React.useMemo(() => {
    if (!dictSearch.trim()) return dictWords
    const q = dictSearch.toLowerCase()
    return dictWords.filter((w) => w.word.toLowerCase().includes(q))
  }, [dictWords, dictSearch])

  const handleDictToggleSelectAll = () => {
    if (dictSelectedIds.size === filteredDictWords.length && filteredDictWords.length > 0) {
      setDictSelectedIds(new Set())
    } else {
      setDictSelectedIds(new Set(filteredDictWords.map((w) => w.id)))
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
        {activeTab === 'results' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }}>
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
            {docsWithErrors.length > 0 && selectedIds.size === 0 && (
              <button
                type="button"
                style={{
                  ...styles.scanBtn,
                  backgroundColor: 'var(--theme-error-500)',
                  ...(scanning ? styles.scanBtnDisabled : {}),
                }}
                onClick={handleScanErrors}
                disabled={scanning}
              >
                {scanning ? 'Analyse...' : `Rescanner erreurs (${docsWithErrors.length})`}
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
        )}
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          type="button"
          style={styles.tab(activeTab === 'results')}
          onClick={() => setActiveTab('results')}
        >
          Résultats
        </button>
        <button
          type="button"
          style={styles.tab(activeTab === 'dictionary')}
          onClick={() => setActiveTab('dictionary')}
        >
          Dictionnaire {dictWords.length > 0 && `(${dictWords.length})`}
        </button>
      </div>

      {/* Toast notification */}
      {dictToast && (
        <div style={{
          padding: '8px 16px',
          marginBottom: '16px',
          borderRadius: '4px',
          backgroundColor: 'var(--theme-success-100, #dcfce7)',
          border: '1px solid var(--theme-success-500)',
          color: 'var(--theme-success-700, #15803d)',
          fontSize: '13px',
        }}>
          {dictToast}
        </div>
      )}

      {/* ===== TAB: Results ===== */}
      {activeTab === 'results' && (
        <>
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
            <div style={styles.progress}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{scanProgress}</span>
                {scanProgress.includes('déjà en cours') && !scanning && (
                  <button
                    type="button"
                    onClick={handleForceReset}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: '4px',
                      backgroundColor: 'var(--theme-error-500)',
                      color: '#fff',
                      cursor: 'pointer',
                      marginLeft: '12px',
                    }}
                  >
                    Forcer réinitialisation
                  </button>
                )}
              </div>
              {scanning && scanTotal > 0 && (
                <div style={styles.progressBar}>
                  <div style={styles.progressFill(Math.round((scanCurrent / scanTotal) * 100))} />
                </div>
              )}
            </div>
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
                                onFix={(original, replacement, offset, length) =>
                                  handleFix(r.docId, r.collection, original, replacement, offset, length)
                                }
                                onIgnore={() => handleIgnore(r.docId, r.collection, issue.ruleId, issue.offset, issue.original)}
                                onAddToDict={handleAddToDict}
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
        </>
      )}

      {/* ===== TAB: Dictionary ===== */}
      {activeTab === 'dictionary' && (
        <>
          {/* Add word input */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
            <input
              type="text"
              value={dictInput}
              onChange={(e) => setDictInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDictAdd() }}
              placeholder="Ajouter un mot (virgules pour plusieurs)..."
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                border: '1px solid var(--theme-elevation-200)',
                borderRadius: '4px',
                backgroundColor: 'var(--theme-elevation-0)',
                color: 'var(--theme-text)',
              }}
            />
            <button
              type="button"
              onClick={handleDictAdd}
              disabled={!dictInput.trim()}
              style={{
                ...styles.scanBtn,
                padding: '8px 16px',
                fontSize: '13px',
                ...(!dictInput.trim() ? styles.scanBtnDisabled : {}),
              }}
            >
              Ajouter
            </button>
          </div>

          {/* Action bar */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' as const }}>
            <input
              type="text"
              value={dictSearch}
              onChange={(e) => setDictSearch(e.target.value)}
              placeholder="Rechercher..."
              style={{
                padding: '6px 10px',
                fontSize: '13px',
                border: '1px solid var(--theme-elevation-200)',
                borderRadius: '4px',
                backgroundColor: 'var(--theme-elevation-0)',
                color: 'var(--theme-text)',
                width: '200px',
              }}
            />
            <span style={{ fontSize: '12px', color: 'var(--theme-elevation-500)' }}>
              {filteredDictWords.length} mot(s)
              {dictSelectedIds.size > 0 && ` — ${dictSelectedIds.size} sélectionné(s)`}
            </span>
            <div style={{ flex: 1 }} />
            {dictSelectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => handleDictDelete([...dictSelectedIds])}
                style={{
                  ...styles.scanBtn,
                  padding: '6px 14px',
                  fontSize: '12px',
                  backgroundColor: 'var(--theme-error-500)',
                }}
              >
                Supprimer ({dictSelectedIds.size})
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowImport(!showImport)}
              style={{
                ...styles.scanBtn,
                padding: '6px 14px',
                fontSize: '12px',
                backgroundColor: 'var(--theme-elevation-600)',
              }}
            >
              {showImport ? 'Annuler' : 'Importer'}
            </button>
            <button
              type="button"
              onClick={handleDictExport}
              disabled={dictWords.length === 0}
              style={{
                ...styles.scanBtn,
                padding: '6px 14px',
                fontSize: '12px',
                backgroundColor: 'var(--theme-elevation-600)',
                ...(dictWords.length === 0 ? styles.scanBtnDisabled : {}),
              }}
            >
              Exporter
            </button>
          </div>

          {/* Import textarea */}
          {showImport && (
            <div style={{
              marginBottom: '16px',
              padding: '16px',
              borderRadius: '6px',
              backgroundColor: 'var(--theme-elevation-50)',
              border: '1px solid var(--theme-elevation-150)',
            }}>
              <div style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--theme-text)' }}>
                Un mot par ligne, ou séparés par des virgules :
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={6}
                style={{
                  width: '100%',
                  padding: '8px',
                  fontSize: '13px',
                  border: '1px solid var(--theme-elevation-200)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--theme-elevation-0)',
                  color: 'var(--theme-text)',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box' as const,
                  resize: 'vertical' as const,
                }}
                placeholder="mot1&#10;mot2&#10;mot3, mot4, mot5"
              />
              <button
                type="button"
                onClick={handleDictImport}
                disabled={!importText.trim()}
                style={{
                  ...styles.scanBtn,
                  marginTop: '8px',
                  padding: '8px 16px',
                  fontSize: '13px',
                  ...(!importText.trim() ? styles.scanBtnDisabled : {}),
                }}
              >
                Importer {importText.trim() ? `(${importText.split(/[,;\n]+/).filter((w) => w.trim()).length} mots)` : ''}
              </button>
            </div>
          )}

          {/* Dictionary table */}
          {dictLoading ? (
            <div style={styles.empty}>Chargement du dictionnaire...</div>
          ) : filteredDictWords.length === 0 ? (
            <div style={styles.empty}>
              {dictSearch ? 'Aucun mot trouvé.' : 'Dictionnaire vide. Ajoutez des mots ci-dessus.'}
            </div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: '36px', cursor: 'default' }}>
                    <input
                      type="checkbox"
                      checked={dictSelectedIds.size === filteredDictWords.length && filteredDictWords.length > 0}
                      onChange={handleDictToggleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th style={{ ...styles.th, cursor: 'default' }}>Mot</th>
                  <th style={{ ...styles.th, cursor: 'default' }}>Ajouté par</th>
                  <th style={{ ...styles.th, cursor: 'default' }}>Date</th>
                  <th style={{ ...styles.th, width: '60px', cursor: 'default' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredDictWords.map((w) => {
                  const isSelected = dictSelectedIds.has(w.id)
                  const addedByName = w.addedBy && typeof w.addedBy === 'object'
                    ? (w.addedBy.name || w.addedBy.email || '—')
                    : '—'
                  return (
                    <tr
                      key={w.id}
                      style={{
                        ...(isSelected ? { backgroundColor: 'var(--theme-elevation-100)' } : {}),
                      }}
                    >
                      <td style={styles.td}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setDictSelectedIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(w.id)) next.delete(w.id)
                              else next.add(w.id)
                              return next
                            })
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 500 }}>
                        {w.word}
                      </td>
                      <td style={{ ...styles.td, fontSize: '12px', color: 'var(--theme-elevation-500)' }}>
                        {addedByName}
                      </td>
                      <td style={{ ...styles.td, fontSize: '12px', color: 'var(--theme-elevation-500)' }}>
                        {w.createdAt
                          ? new Date(w.createdAt).toLocaleString('fr-FR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td style={styles.td}>
                        <button
                          type="button"
                          onClick={() => handleDictDelete([w.id])}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--theme-error-500)',
                            fontSize: '14px',
                            padding: '2px 6px',
                          }}
                          title="Supprimer"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

export default SpellCheckDashboard
