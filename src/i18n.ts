/**
 * Spellcheck Plugin — i18n translations (FR/EN).
 */

export type SpellcheckLocale = 'fr' | 'en'

export interface SpellcheckTranslations {
  // Dashboard
  dashboardTitle: string
  dashboardDescription: string
  scanAll: string
  scanning: string
  scanComplete: string
  noIssues: string
  issuesFound: (count: number) => string
  score: string
  wordCount: string
  lastChecked: string
  collection: string
  document: string
  issues: string
  actions: string

  // Field sidebar
  fieldTitle: string
  fieldDescription: string
  checkNow: string
  checking: string
  fixAll: string
  fix: string
  ignore: string
  autoChecked: string

  // Issue card
  suggestion: string
  noSuggestion: string
  context: string
  rule: string
  category: string
  applied: string
  source: string

  // Status
  excellent: string
  good: string
  needsWork: string
  poor: string

  // Errors
  errorFetching: string
  errorFixing: string
  unauthorized: string
}

const fr: SpellcheckTranslations = {
  dashboardTitle: 'Correcteur orthographique',
  dashboardDescription: 'Analyse orthographique et grammaticale du contenu',
  scanAll: 'Scanner tout',
  scanning: 'Analyse en cours...',
  scanComplete: 'Analyse terminée',
  noIssues: 'Aucun problème détecté',
  issuesFound: (count) => `${count} problème${count > 1 ? 's' : ''} détecté${count > 1 ? 's' : ''}`,
  score: 'Score',
  wordCount: 'Mots',
  lastChecked: 'Dernière vérification',
  collection: 'Collection',
  document: 'Document',
  issues: 'Problèmes',
  actions: 'Actions',

  fieldTitle: 'Orthographe',
  fieldDescription: 'Vérification orthographique et grammaticale',
  checkNow: 'Vérifier',
  checking: 'Vérification...',
  fixAll: 'Tout corriger',
  fix: 'Corriger',
  ignore: 'Ignorer',
  autoChecked: 'Vérifié automatiquement',

  suggestion: 'Suggestion',
  noSuggestion: 'Aucune suggestion',
  context: 'Contexte',
  rule: 'Règle',
  category: 'Catégorie',
  applied: 'Corrigé',
  source: 'Source',

  excellent: 'Excellent',
  good: 'Bon',
  needsWork: 'À améliorer',
  poor: 'Insuffisant',

  errorFetching: 'Erreur lors de l\'analyse',
  errorFixing: 'Erreur lors de la correction',
  unauthorized: 'Non autorisé',
}

const en: SpellcheckTranslations = {
  dashboardTitle: 'Spellchecker',
  dashboardDescription: 'Spelling and grammar analysis of content',
  scanAll: 'Scan all',
  scanning: 'Scanning...',
  scanComplete: 'Scan complete',
  noIssues: 'No issues found',
  issuesFound: (count) => `${count} issue${count > 1 ? 's' : ''} found`,
  score: 'Score',
  wordCount: 'Words',
  lastChecked: 'Last checked',
  collection: 'Collection',
  document: 'Document',
  issues: 'Issues',
  actions: 'Actions',

  fieldTitle: 'Spelling',
  fieldDescription: 'Spelling and grammar check',
  checkNow: 'Check',
  checking: 'Checking...',
  fixAll: 'Fix all',
  fix: 'Fix',
  ignore: 'Ignore',
  autoChecked: 'Auto-checked',

  suggestion: 'Suggestion',
  noSuggestion: 'No suggestion',
  context: 'Context',
  rule: 'Rule',
  category: 'Category',
  applied: 'Fixed',
  source: 'Source',

  excellent: 'Excellent',
  good: 'Good',
  needsWork: 'Needs work',
  poor: 'Poor',

  errorFetching: 'Error during analysis',
  errorFixing: 'Error applying fix',
  unauthorized: 'Unauthorized',
}

const translations: Record<SpellcheckLocale, SpellcheckTranslations> = { fr, en }

export function getTranslations(locale: SpellcheckLocale = 'fr'): SpellcheckTranslations {
  return translations[locale] || translations.fr
}

export function getScoreLabel(score: number, t: SpellcheckTranslations): string {
  if (score >= 95) return t.excellent
  if (score >= 80) return t.good
  if (score >= 50) return t.needsWork
  return t.poor
}
