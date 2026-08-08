/**
 * Spellcheck Plugin — Type definitions.
 */

import type { ReadabilityResult } from './engine/readability.js'
import type { ConsistencyIssue } from './engine/consistency.js'

export interface SpellCheckIssue {
  /** LanguageTool rule ID (e.g. 'GRAMMAR', 'MORFOLOGIK_RULE_FR') */
  ruleId: string
  /** LanguageTool category (e.g. 'GRAMMAR', 'TYPOS') */
  category: string
  /** Human-readable message explaining the issue */
  message: string
  /** Text context around the error */
  context: string
  /** Offset of the error within the context string */
  contextOffset: number
  /** Offset within the full extracted text */
  offset: number
  /** Length of the problematic text */
  length: number
  /** The original (wrong) text */
  original: string
  /** Suggested replacements (max 3) */
  replacements: string[]
  /** Source engine: 'languagetool' or 'claude' */
  source: 'languagetool' | 'claude'
  /** Whether this is a premium-only rule */
  isPremium?: boolean
}

export interface SpellCheckResult {
  /** Document ID */
  docId: string | number
  /** Collection slug */
  collection: string
  /** Score 0-100 (100 = no issues) */
  score: number
  /** Number of issues found */
  issueCount: number
  /** Word count of the extracted text */
  wordCount: number
  /** Detailed issues */
  issues: SpellCheckIssue[]
  /** Readability analysis results */
  readability?: ReadabilityResult
  /** Consistency check results */
  consistency?: ConsistencyIssue[]
  /** ISO date of last check */
  lastChecked: string
}

export interface SpellCheckPluginConfig {
  /** Access control function — return true to allow access (default: admin only) */
  access?: (req: { user?: Record<string, unknown> | null }) => boolean
  /** Collections to check (default: ['pages', 'posts']) */
  collections?: string[]
  /** Rich text field name to extract content from (default: 'content') */
  contentField?: string
  /** Language for LanguageTool (default: 'fr') */
  language?: string
  /** Run spellcheck automatically on save (default: true) */
  checkOnSave?: boolean
  /** Add sidebar field in the editor (default: true) */
  addSidebarField?: boolean
  /** Add dashboard view at /admin/spellcheck (default: true) */
  addDashboardView?: boolean
  /** Add score column in collection list views (default: true) */
  addListColumn?: boolean
  /** Base path for API endpoints (default: '/spellcheck') */
  endpointBasePath?: string

  /** Enable Claude AI as semantic fallback (default: false) */
  enableAiFallback?: boolean
  /** Anthropic API key for Claude fallback */
  anthropicApiKey?: string

  /** LanguageTool rule IDs to skip */
  skipRules?: string[]
  /** LanguageTool categories to skip */
  skipCategories?: string[]
  /** Custom dictionary — words to never flag */
  customDictionary?: string[]

  /** Package name used for component imports (default: '@consilioweb/payload-spellcheck') */
  packageName?: string
  /** LanguageTool API URL (default: 'https://api.languagetool.org/v2/check') — use for self-hosted instances */
  languageToolUrl?: string
  /** Score below which a warning is shown in the UI (default: 80) */
  warningThreshold?: number
  /** Attempt to auto-fix missing schema columns on init (default: true) */
  autoFixSchema?: boolean

  /** Rate limit overrides for API endpoints */
  rateLimits?: {
    /** Max requests per window for /validate (default: 30) */
    validate?: number
    /** Max requests per window for /fix (default: 20) */
    fix?: number
    /** Max requests per window for /fix-all (default: 5) */
    fixAll?: number
    /** Max requests per window for /bulk (default: 3) */
    bulk?: number
    /** Max requests per window for /dictionary (default: 60) */
    dictionary?: number
    /** Rate limit window in milliseconds (default: 60000) */
    windowMs?: number
  }

  /** Timeout and limit overrides */
  timeouts?: {
    /** LanguageTool API request timeout in ms (default: 30000) */
    languageTool?: number
    /** Claude API request timeout in ms (default: 60000) */
    claude?: number
    /** Max text length sent to LanguageTool in characters (default: 18000) */
    maxTextLengthLanguageTool?: number
    /** Max text length sent to Claude in characters (default: 8000) */
    maxTextLengthClaude?: number
    /** Delay between LanguageTool API calls during bulk scan in ms (default: 3000) */
    bulkRateLimitDelay?: number
    /** Stale job timeout for bulk scans in ms (default: 600000) */
    bulkStaleTimeout?: number
  }
}
