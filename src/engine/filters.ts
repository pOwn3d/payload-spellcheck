/**
 * Filter false positives from LanguageTool results.
 * Removes premium rules, skipped rules/categories, and custom dictionary matches.
 */

import type { SpellCheckIssue, SpellCheckPluginConfig } from '../types.js'
import { loadDictionaryWords } from '../endpoints/dictionary.js'

/** Default rules to skip (common false positives for web content) */
const DEFAULT_SKIP_RULES = new Set([
  'WHITESPACE_RULE',
  'COMMA_PARENTHESIS_WHITESPACE',
  'UNPAIRED_BRACKETS',
  'UPPERCASE_SENTENCE_START',     // Headings/titles don't start with uppercase
  'FRENCH_WHITESPACE',            // Non-breaking spaces are inconsistent in CMS
  'MORFOLOGIK_RULE_FR_FR',        // Overly aggressive French spelling (flags proper nouns)
  'APOS_TYP',                     // Typography apostrophe (curly vs straight)
  'POINT_VIRGULE',                // Semicolon spacing
  'DASH_RULE',                    // Dash types (em vs en)
  'FRENCH_WORD_REPEAT_RULE',      // Repetitions from heading+body extraction
  'MOT_TRAIT_MOT',                // Hyphenated English tech terms (mobile-first, utility-first)
  'PAS_DE_TRAIT_UNION',           // Prefix hyphenation (multi-appareils)
])

/** Default categories to skip (English + French LanguageTool category IDs) */
const DEFAULT_SKIP_CATEGORIES = new Set([
  // English categories
  'TYPOGRAPHY',
  'TYPOS',
  'STYLE',
  // French categories (LanguageTool uses different IDs for French)
  'CAT_TYPOGRAPHIE',              // French typography rules
  'REPETITIONS_STYLE',            // French style/repetition suggestions
  'CAT_REGLES_DE_BASE',           // French basic rules (word repetition from CMS extraction)
])

/** Patterns that indicate non-natural-language content */
const SKIP_PATTERNS = [
  /^https?:\/\//i,                // URLs
  /^mailto:/i,                    // Email links
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, // Emails
  /^[A-Z][a-z]+[A-Z]/,           // CamelCase (JavaScript, TypeScript)
  /^[A-Z]{2,}$/,                  // All caps abbreviations (API, CSS, SEO)
  /^\d+[\d.,]*$/,                 // Numbers
  /^\d+[a-zA-Z]+$/,              // Numbers with units (80px, 24h, mp3)
  /^[#@]/,                        // Hashtags, mentions
  /^[€$£¥]/,                      // Currency amounts
  /^0[1-9]\d{8}$/,               // French phone numbers
  /^\+?\d[\d\s.-]{8,}$/,         // International phone numbers
  /^[a-z-]+\.[a-z]{2,}$/i,       // Domain names
]

/**
 * Filter out false positives based on plugin configuration.
 * Merges hardcoded customDictionary with dynamic DB dictionary words.
 */
export async function filterFalsePositives(
  issues: SpellCheckIssue[],
  config: SpellCheckPluginConfig,
  payload?: { find: Function },
): Promise<SpellCheckIssue[]> {
  const skipRules = new Set([
    ...DEFAULT_SKIP_RULES,
    ...(config.skipRules || []),
  ])

  const skipCategories = new Set([
    ...DEFAULT_SKIP_CATEGORIES,
    ...(config.skipCategories || []),
  ])

  // Merge hardcoded config dictionary + dynamic DB dictionary
  const configWords = (config.customDictionary || []).map((w) => w.toLowerCase())
  const dbWords = payload ? await loadDictionaryWords(payload) : []
  const dictionaryWords = [...new Set([...configWords, ...dbWords])]
  const dictionary = new Set(dictionaryWords)

  return issues.filter((issue) => {
    // Skip premium rules
    if (issue.isPremium) return false

    // Skip configured rules
    if (skipRules.has(issue.ruleId)) return false

    // Skip configured categories
    if (skipCategories.has(issue.category)) return false

    // Skip if the original word is in custom dictionary (exact match)
    if (issue.original && dictionary.has(issue.original.toLowerCase())) return false

    // Skip if original contains a dictionary word (partial match for compound words)
    if (issue.original) {
      const lower = issue.original.toLowerCase()
      for (const word of dictionaryWords) {
        if (lower.includes(word) || word.includes(lower)) return false
      }
    }

    // Skip if the context contains a multi-word dictionary phrase (e.g. "variable fonts", "media query")
    // This catches cases where LanguageTool flags French grammar around English compound terms
    if (issue.context) {
      const ctxLower = issue.context.toLowerCase()
      for (const word of dictionaryWords) {
        if (word.includes(' ') && ctxLower.includes(word)) {
          return false
        }
      }
    }

    // Skip single-character issues (often punctuation false positives)
    if (issue.original && issue.original.length <= 1 && issue.category !== 'GRAMMAR') return false

    // Skip patterns that are not natural language
    if (issue.original) {
      for (const pattern of SKIP_PATTERNS) {
        if (pattern.test(issue.original)) return false
      }
    }

    // Skip issues where the suggestion is the same as original (LanguageTool bug)
    if (issue.replacements.length > 0 && issue.replacements[0] === issue.original) return false

    // Skip issues in very short context (likely a label or button text)
    if (issue.context && issue.context.trim().length < 5) return false

    // Skip repetition issues for dictionary words (heading + body text causes false duplication)
    if (issue.ruleId.includes('REPET') || issue.category === 'CAT_REGLES_DE_BAS') {
      if (issue.original) {
        const lower = issue.original.toLowerCase()
        for (const word of dictionaryWords) {
          if (lower.includes(word) || word.includes(lower)) return false
        }
      }
      // Skip repetition when replacement is empty or equals original (just remove duplication)
      if (issue.replacements.length > 0 && issue.replacements[0] === issue.original) return false
      if (issue.replacements.length > 0 && issue.replacements[0] === '') return false
    }

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
