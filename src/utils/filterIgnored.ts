/**
 * Shared helper to filter out user-ignored issues from a spellcheck result.
 */

import type { SpellCheckIssue } from '../types.js'

export interface IgnoredIssue {
  ruleId: string
  original: string
}

/**
 * Remove issues that match any entry in the ignoredIssues list.
 * Matching is done on both ruleId AND original text (exact match).
 */
export function filterIgnoredIssues(
  issues: SpellCheckIssue[],
  ignoredIssues: IgnoredIssue[],
): SpellCheckIssue[] {
  if (!ignoredIssues.length) return issues

  return issues.filter(
    (issue) => !ignoredIssues.some(
      (ignored) => ignored.ruleId === issue.ruleId && ignored.original === issue.original,
    ),
  )
}
