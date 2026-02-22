/**
 * Filter false positives from LanguageTool results.
 * Removes premium rules, skipped rules/categories, and custom dictionary matches.
 */

import type { SpellCheckIssue, SpellCheckPluginConfig } from '../types.js'

/** Default rules to skip (common false positives for web content) */
const DEFAULT_SKIP_RULES = new Set([
  'WHITESPACE_RULE',
  'COMMA_PARENTHESIS_WHITESPACE',
  'UNPAIRED_BRACKETS',
])

/** Default categories to skip */
const DEFAULT_SKIP_CATEGORIES = new Set([
  'TYPOGRAPHY',
])

/**
 * Filter out false positives based on plugin configuration.
 */
export function filterFalsePositives(
  issues: SpellCheckIssue[],
  config: SpellCheckPluginConfig,
): SpellCheckIssue[] {
  const skipRules = new Set([
    ...DEFAULT_SKIP_RULES,
    ...(config.skipRules || []),
  ])

  const skipCategories = new Set([
    ...DEFAULT_SKIP_CATEGORIES,
    ...(config.skipCategories || []),
  ])

  // Build a lowercase set of custom dictionary words
  const dictionary = new Set(
    (config.customDictionary || []).map((w) => w.toLowerCase()),
  )

  return issues.filter((issue) => {
    // Skip premium rules
    if (issue.isPremium) return false

    // Skip configured rules
    if (skipRules.has(issue.ruleId)) return false

    // Skip configured categories
    if (skipCategories.has(issue.category)) return false

    // Skip if the original word is in custom dictionary
    if (issue.original && dictionary.has(issue.original.toLowerCase())) return false

    // Skip single-character issues (often punctuation false positives)
    if (issue.original && issue.original.length <= 1 && issue.category !== 'GRAMMAR') return false

    return true
  })
}

/**
 * Calculate a spellcheck score (0-100) based on word count and issue count.
 * 100 = no issues, decreases with each issue relative to word count.
 */
export function calculateScore(wordCount: number, issueCount: number): number {
  if (wordCount === 0) return 100
  if (issueCount === 0) return 100

  // Each issue penalizes proportionally to text length
  // ~1 issue per 100 words = score ~90
  // ~5 issues per 100 words = score ~50
  const issuesPerHundredWords = (issueCount / wordCount) * 100
  const score = Math.max(0, Math.round(100 - issuesPerHundredWords * 10))
  return Math.min(100, score)
}
