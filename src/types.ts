/**
 * Spellcheck Plugin — Type definitions.
 */

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
  /** ISO date of last check */
  lastChecked: string
}

export interface SpellCheckPluginConfig {
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
  /** Minimum score threshold for warnings (default: 80) */
  warningThreshold?: number
}
