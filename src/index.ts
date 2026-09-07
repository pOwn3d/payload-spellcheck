// Server entry — plugin + engine + types
export { spellcheckPlugin } from './plugin.js'
export type {
  SpellCheckPluginConfig,
  SpellCheckIssue,
  SpellCheckResult,
} from './types.js'
export { extractTextFromLexical, extractAllTextFromDoc, extractAllTextFromDocWithSources, countWords } from './engine/lexicalParser.js'
export type { TextSegment, ExtractedDoc } from './engine/lexicalParser.js'
export { checkWithLanguageTool, runLanguageToolCheck } from './engine/languagetool.js'
export type { LanguageToolOutcome } from './engine/languagetool.js'
export { checkWithClaude, runClaudeCheck } from './engine/claude.js'
export type { ClaudeOutcome } from './engine/claude.js'
export { filterFalsePositives, calculateScore, DEFAULT_SKIP_RULES, DEFAULT_SKIP_CATEGORIES } from './engine/filters.js'
export { loadDictionaryWords, invalidateDictionaryCache } from './endpoints/dictionary.js'
export { analyzeReadability } from './engine/readability.js'
export type { ReadabilityResult } from './engine/readability.js'
export { checkConsistency } from './engine/consistency.js'
export type { ConsistencyIssue } from './engine/consistency.js'
export { createFixAllHandler } from './endpoints/fixAll.js'
export type { FixAllResult } from './endpoints/fixAll.js'
export { getTranslations, getScoreLabel } from './i18n.js'
export type { SpellcheckLocale, SpellcheckTranslations } from './i18n.js'
