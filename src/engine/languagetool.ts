/**
 * LanguageTool API client.
 * Sends text to the public LanguageTool API and parses results into SpellCheckIssue[].
 *
 * Rate limit: max 1 request per 3 seconds on the free API.
 * Max text length: 18,000 characters.
 */

import type { SpellCheckIssue, SpellCheckPluginConfig } from '../types.js'

const LANGUAGETOOL_API = 'https://api.languagetool.org/v2/check'
const MAX_TEXT_LENGTH = 18_000
const REQUEST_TIMEOUT = 30_000

interface LTMatch {
  message: string
  offset: number
  length: number
  replacements: Array<{ value: string }>
  context: {
    text: string
    offset: number
    length: number
  }
  rule: {
    id: string
    category: { id: string; name: string }
    isPremium?: boolean
  }
}

interface LTResponse {
  matches: LTMatch[]
}

/**
 * Check text with LanguageTool API.
 * Returns raw SpellCheckIssue[] (before filtering).
 */
export async function checkWithLanguageTool(
  text: string,
  language: string,
  config: SpellCheckPluginConfig,
): Promise<SpellCheckIssue[]> {
  if (!text.trim()) return []

  // Truncate to API limit
  const truncatedText = text.length > MAX_TEXT_LENGTH
    ? text.slice(0, MAX_TEXT_LENGTH)
    : text

  // Build disabled rules param
  const disabledRules = [
    ...(config.skipRules || []),
    'WHITESPACE_RULE',
    'COMMA_PARENTHESIS_WHITESPACE',
    'UNPAIRED_BRACKETS',
  ].join(',')

  const params = new URLSearchParams({
    text: truncatedText,
    language,
    disabledRules,
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(LANGUAGETOOL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`LanguageTool API error: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as LTResponse
    return parseMatches(data.matches || [])
  } catch (error) {
    clearTimeout(timeoutId)
    if ((error as Error).name === 'AbortError') {
      console.error('[spellcheck] LanguageTool request timed out')
      return []
    }
    console.error('[spellcheck] LanguageTool error:', error)
    return []
  }
}

/**
 * Parse LanguageTool matches into SpellCheckIssue[].
 */
function parseMatches(matches: LTMatch[]): SpellCheckIssue[] {
  return matches.map((m) => ({
    ruleId: m.rule.id,
    category: m.rule.category.id,
    message: m.message,
    context: m.context.text,
    offset: m.offset,
    length: m.length,
    original: m.context.text.slice(m.context.offset, m.context.offset + m.context.length),
    replacements: m.replacements.slice(0, 3).map((r) => r.value),
    source: 'languagetool' as const,
    isPremium: m.rule.isPremium ?? false,
  }))
}
