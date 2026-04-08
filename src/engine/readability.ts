/**
 * Readability analysis engine.
 * Implements Flesch-Kincaid (English) and Kandel-Moles (French) formulas.
 */

export interface ReadabilityResult {
  /** Readability score (higher = easier to read) */
  score: number
  /** Human-readable grade level */
  grade: string
  /** Average words per sentence */
  avgSentenceLength: number
  /** Average syllables per word */
  avgSyllablesPerWord: number
  /** Total number of sentences */
  sentenceCount: number
  /** Total number of words */
  wordCount: number
}

// ─── Syllable counting ──────────────────────────────────────────────────

/** French silent-e and common patterns */
const FR_SILENT_ENDINGS = /e(s)?$/
const FR_VOWELS = /[aeiouyàâäéèêëïîôùûüÿœæ]/gi

/**
 * Count syllables in a French word.
 * Based on vowel groups, with adjustments for silent endings and diphthongs.
 */
function countSyllablesFr(word: string): number {
  const lower = word.toLowerCase().trim()
  if (!lower || lower.length <= 2) return 1

  // Count vowel groups (consecutive vowels = 1 syllable)
  let count = 0
  let prevVowel = false

  for (const char of lower) {
    const isVowel = FR_VOWELS.test(char)
    // Reset regex lastIndex (global flag side effect)
    FR_VOWELS.lastIndex = 0
    if (isVowel && !prevVowel) {
      count++
    }
    prevVowel = isVowel
  }

  // Silent final 'e' or 'es' — subtract 1 (but keep at least 1)
  if (FR_SILENT_ENDINGS.test(lower) && count > 1) {
    count--
  }

  return Math.max(1, count)
}

const EN_VOWELS = /[aeiouy]/gi

/**
 * Count syllables in an English word.
 * Vowel-groups method with adjustments for silent-e and common patterns.
 */
function countSyllablesEn(word: string): number {
  const lower = word.toLowerCase().trim()
  if (!lower || lower.length <= 2) return 1

  // Count vowel groups
  let count = 0
  let prevVowel = false

  for (const char of lower) {
    const isVowel = EN_VOWELS.test(char)
    EN_VOWELS.lastIndex = 0
    if (isVowel && !prevVowel) {
      count++
    }
    prevVowel = isVowel
  }

  // Silent final 'e' (but not 'le', 'ce', etc.)
  if (lower.endsWith('e') && !lower.endsWith('le') && !lower.endsWith('ce') && count > 1) {
    count--
  }

  return Math.max(1, count)
}

// ─── Sentence splitting ─────────────────────────────────────────────────

/** Split text into sentences (handles ., !, ?, and common abbreviations) */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end of string
  const raw = text
    .replace(/\n+/g, '. ')  // Treat newlines as sentence boundaries
    .split(/[.!?]+\s+|[.!?]+$/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  return raw.length > 0 ? raw : [text]
}

/** Extract words from text */
function extractWords(text: string): string[] {
  return text
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')  // Keep letters, numbers, hyphens, apostrophes
    .split(/\s+/)
    .filter((w) => w.length > 0 && /\p{L}/u.test(w))  // Must contain at least one letter
}

// ─── Grade labels ───────────────────────────────────────────────────────

function getGradeFr(score: number): string {
  if (score >= 80) return 'Très facile'
  if (score >= 60) return 'Facile'
  if (score >= 40) return 'Assez facile'
  if (score >= 20) return 'Difficile'
  return 'Très difficile'
}

function getGradeEn(score: number): string {
  if (score >= 80) return 'Very easy'
  if (score >= 60) return 'Easy'
  if (score >= 40) return 'Fairly easy'
  if (score >= 20) return 'Difficult'
  return 'Very difficult'
}

// ─── Main analysis ──────────────────────────────────────────────────────

/**
 * Analyze text readability using the appropriate formula for the language.
 *
 * English: Flesch Reading Ease = 206.835 - 1.015 * ASL - 84.6 * ASW
 * French:  Kandel-Moles       = 207     - 1.015 * ASL - 73.6 * ASW
 *
 * where ASL = average sentence length (words), ASW = average syllables per word.
 */
export function analyzeReadability(text: string, language: 'fr' | 'en'): ReadabilityResult {
  const sentences = splitSentences(text)
  const words = extractWords(text)

  const sentenceCount = sentences.length
  const wordCount = words.length

  // Not enough content to analyze
  if (wordCount < 3 || sentenceCount === 0) {
    return {
      score: 100,
      grade: language === 'fr' ? 'Très facile' : 'Very easy',
      avgSentenceLength: wordCount,
      avgSyllablesPerWord: 1,
      sentenceCount,
      wordCount,
    }
  }

  const countSyllables = language === 'fr' ? countSyllablesFr : countSyllablesEn
  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0)

  const avgSentenceLength = wordCount / sentenceCount
  const avgSyllablesPerWord = totalSyllables / wordCount

  let score: number
  if (language === 'fr') {
    // Kandel-Moles formula for French
    score = 207 - 1.015 * avgSentenceLength - 73.6 * avgSyllablesPerWord
  } else {
    // Flesch Reading Ease for English
    score = 206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord
  }

  // Clamp to 0-100 range
  score = Math.round(Math.max(0, Math.min(100, score)))

  const getGrade = language === 'fr' ? getGradeFr : getGradeEn
  const grade = getGrade(score)

  return {
    score,
    grade,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
    sentenceCount,
    wordCount,
  }
}
