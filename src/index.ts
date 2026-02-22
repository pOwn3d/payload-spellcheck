// Server entry — plugin + engine + types
export { spellcheckPlugin } from './plugin.js'
export type {
  SpellCheckPluginConfig,
  SpellCheckIssue,
  SpellCheckResult,
} from './types.js'
export { extractTextFromLexical, extractAllTextFromDoc, countWords } from './engine/lexicalParser.js'
export { checkWithLanguageTool } from './engine/languagetool.js'
export { checkWithClaude } from './engine/claude.js'
export { filterFalsePositives, calculateScore } from './engine/filters.js'
export { getTranslations, getScoreLabel } from './i18n.js'
export type { SpellcheckLocale, SpellcheckTranslations } from './i18n.js'
