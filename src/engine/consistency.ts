/**
 * Consistency checker — detect inconsistent term usage across a document.
 * Finds mixed capitalization, mixed spelling variants, and mixed abbreviations.
 */

export interface ConsistencyIssue {
  /** Normalized form of the term (lowercase, no punctuation) */
  term: string
  /** All variants found with their occurrence count */
  variants: { text: string; count: number }[]
}

// ─── Normalization ──────────────────────────────────────────────────────

/** Normalize a term for grouping: lowercase, remove dots, collapse whitespace/hyphens */
function normalize(term: string): string {
  return term
    .toLowerCase()
    .replace(/\./g, '')       // A.P.I. → api
    .replace(/[\s-]+/g, '')   // e-commerce, e commerce → ecommerce
    .trim()
}

// ─── Word extraction (preserving original form) ─────────────────────────

/**
 * Extract "interesting" tokens from text — words that could have variant spellings.
 * Includes hyphenated compounds and dot-separated abbreviations.
 */
function extractTokens(text: string): string[] {
  // Match words including hyphens, dots, and apostrophes as part of the token
  const regex = /[\p{L}\p{N}]+(?:[.\-']\p{L}[\p{L}\p{N}]*)*/gu
  const matches = text.match(regex)
  return matches || []
}

// ─── Main analysis ──────────────────────────────────────────────────────

/**
 * Check text for inconsistent term usage.
 *
 * Groups tokens by their normalized form and flags groups where:
 * - Multiple distinct surface forms exist (e.g. "TypeScript" vs "typescript")
 * - At least 2 total occurrences (don't flag hapax)
 *
 * Returns only groups with 2+ distinct variants.
 */
export function checkConsistency(text: string): ConsistencyIssue[] {
  const tokens = extractTokens(text)

  // Group by normalized form
  const groups = new Map<string, Map<string, number>>()

  for (const token of tokens) {
    // Skip very short tokens (articles, prepositions)
    if (token.length < 3) continue

    const key = normalize(token)
    if (key.length < 3) continue

    if (!groups.has(key)) {
      groups.set(key, new Map())
    }
    const variants = groups.get(key)!
    variants.set(token, (variants.get(token) || 0) + 1)
  }

  // Filter to groups with multiple distinct variants
  const issues: ConsistencyIssue[] = []

  for (const [term, variantMap] of groups) {
    if (variantMap.size < 2) continue

    // Ensure there are at least 2 total occurrences
    const totalCount = [...variantMap.values()].reduce((a, b) => a + b, 0)
    if (totalCount < 2) continue

    const variants = [...variantMap.entries()]
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)  // Most frequent first

    issues.push({ term, variants })
  }

  // Sort by number of variants (most inconsistent first)
  return issues.sort((a, b) => b.variants.length - a.variants.length)
}
