/**
 * SpellCheckScoreCell — custom Cell component for collection list views.
 * Shows the spellcheck score badge (green/yellow/red) inline in the table.
 */

'use client'

import React, { useEffect, useState } from 'react'

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

    fetch(
      `/api/spellcheck-results?where[docId][equals]=${rowData.id}&where[collection][equals]=${collectionSlug}&limit=1&depth=0`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.docs?.[0]) {
          setScore(data.docs[0].score)
          setIssueCount(data.docs[0].issueCount ?? 0)
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
