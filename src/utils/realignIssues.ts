/**
 * Re-align a stored spellcheck result after a single correction.
 *
 * Every fix writes with `context: { skipSpellcheck: true }` (anti-loop), so the
 * afterChange hook no longer refreshes the stored result — the offsets it holds
 * were computed on the text BEFORE the correction. `/fix-all` pays for one full
 * re-check after its batch; the unit `/fix` endpoint cannot afford a
 * LanguageTool round-trip per clicked word (that is exactly the traffic the
 * anti-loop guard was installed to remove), so it re-aligns arithmetically
 * instead: the correction is a pure splice, and a splice moves nothing before
 * it and everything after it by a known delta.
 */

import type { Payload } from 'payload'
import type { SpellCheckIssue } from '../types.js'
import { calculateScore } from '../engine/filters.js'
import { findSpellcheckResult, upsertSpellcheckResult } from './upsertResult.js'

/** The span of extracted text a fix replaced, in `fullText` coordinates. */
export interface AppliedFixSpan {
  /** Offset where the replacement was written */
  offset: number
  /** Length of the text that was replaced */
  length: number
  /** Length of the text that took its place */
  replacementLength: number
}

/**
 * Shift the issues that sit after a correction, drop the ones it overwrote.
 *
 * Pure function — no I/O, so the invariant is testable without a database.
 */
export function realignIssues(
  issues: SpellCheckIssue[],
  span: AppliedFixSpan,
): SpellCheckIssue[] {
  const start = span.offset
  const end = span.offset + span.length
  const delta = span.replacementLength - span.length

  const realigned: SpellCheckIssue[] = []

  for (const issue of issues) {
    if (typeof issue.offset !== 'number' || typeof issue.length !== 'number') continue

    // Entirely before the correction — untouched.
    if (issue.offset + issue.length <= start) {
      realigned.push(issue)
      continue
    }

    // Entirely after — the whole tail moved by `delta`.
    if (issue.offset >= end) {
      realigned.push(delta === 0 ? issue : { ...issue, offset: issue.offset + delta })
      continue
    }

    // Overlaps the rewritten span: the issue that was just fixed, or a second
    // rule flagging the same words. Either way its coordinates no longer
    // describe anything — drop it rather than keep a booby-trapped offset.
  }

  return realigned
}

/**
 * Apply {@link realignIssues} to the result stored for a document.
 * Returns true when a stored result was found and rewritten.
 */
export async function realignStoredResult(
  payload: Payload,
  collectionSlug: string,
  docId: string,
  span: AppliedFixSpan,
): Promise<boolean> {
  const stored = await findSpellcheckResult(payload, docId, collectionSlug)
  if (!stored) return false

  const issues: SpellCheckIssue[] = Array.isArray(stored.issues) ? stored.issues : []
  if (issues.length === 0) return false

  const next = realignIssues(issues, span)
  const wordCount = typeof stored.wordCount === 'number' ? stored.wordCount : 0

  await upsertSpellcheckResult(payload, docId, collectionSlug, {
    issues: next as unknown as Record<string, unknown>[],
    issueCount: next.length,
    score: calculateScore(wordCount, next.length),
  })

  return true
}
