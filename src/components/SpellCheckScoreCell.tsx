/**
 * SpellCheckScoreCell — custom Cell component for collection list views.
 * Shows the spellcheck score badge (green/yellow/red) inline in the table.
 */

'use client'

import React, { useEffect, useState } from 'react'

// Client-side score cache to avoid N+1 queries (one fetch per cell in list view).
// Entries expire after CACHE_TTL ms. The cache is module-scoped so it persists
// across re-renders but resets on page navigation (SPA client-side).
const scoreCache = new Map<string, { score: number; issueCount: number; timestamp: number }>()
const CACHE_TTL = 30_000 // 30 seconds

interface SpellCheckScoreCellProps {
  rowData?: { id?: string | number; [key: string]: unknown }
  collectionSlug?: string
  cellData?: unknown
}

export const SpellCheckScoreCell: React.FC<SpellCheckScoreCellProps> = ({
  rowData,
  collectionSlug,
}) => {
  const [score, setScore] = useState<number | null>(null)
  const [issueCount, setIssueCount] = useState<number | null>(null)

  useEffect(() => {
    if (!rowData?.id || !collectionSlug) return

    const cacheKey = `${collectionSlug}:${rowData.id}`
    const cached = scoreCache.get(cacheKey)
    const now = Date.now()

    // Return cached value if still fresh
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      setScore(cached.score)
      setIssueCount(cached.issueCount)
      return
    }

    fetch(
      `/api/spellcheck-results?where[docId][equals]=${rowData.id}&where[collection][equals]=${collectionSlug}&limit=1&depth=0`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.docs?.[0]) {
          const s = data.docs[0].score
          const ic = data.docs[0].issueCount ?? 0
          setScore(s)
          setIssueCount(ic)
          scoreCache.set(cacheKey, { score: s, issueCount: ic, timestamp: Date.now() })
        }
      })
      .catch(() => {})
  }, [rowData?.id, collectionSlug])

  if (score === null) {
    return <span style={{ fontSize: '12px', color: 'var(--theme-elevation-400)' }}>—</span>
  }

  const bgColor =
    score >= 95
      ? 'var(--theme-success-500)'
      : score >= 80
        ? '#f59e0b'
        : 'var(--theme-error-500)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '10px',
          fontSize: '12px',
          fontWeight: 700,
          color: '#fff',
          backgroundColor: bgColor,
        }}
      >
        {score}
      </span>
      {issueCount !== null && issueCount > 0 && (
        <span style={{ fontSize: '11px', color: 'var(--theme-error-500)' }}>
          {issueCount}
        </span>
      )}
    </span>
  )
}

export default SpellCheckScoreCell
