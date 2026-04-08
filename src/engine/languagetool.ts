/**
 * LanguageTool API client.
 * Sends text to the public LanguageTool API and parses results into SpellCheckIssue[].
 *
 * Rate limit: max 1 request per 3 seconds on the free API.
 * Max text length: 18,000 characters.
 */

import type { SpellCheckIssue, SpellCheckPluginConfig } from '../types.js'

const DEFAULT_LANGUAGETOOL_API = 'https://api.languagetool.org/v2/check'
const DEFAULT_MAX_TEXT_LENGTH = 18_000
const DEFAULT_REQUEST_TIMEOUT = 30_000

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
  logger?: { error: (msg: string) => void },
): Promise<SpellCheckIssue[]> {
  if (!text.trim()) return []

  const apiUrl = config.languageToolUrl || DEFAULT_LANGUAGETOOL_API
  const maxTextLength = config.timeouts?.maxTextLengthLanguageTool ?? DEFAULT_MAX_TEXT_LENGTH
  const requestTimeout = config.timeouts?.languageTool ?? DEFAULT_REQUEST_TIMEOUT

  // Truncate to API limit
  const truncatedText = text.length > maxTextLength
    ? text.slice(0, maxTextLength)
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
  const timeoutId = setTimeout(() => controller.abort(), requestTimeout)

  try {
    const response = await fetch(apiUrl, {
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
      logger?.error('[spellcheck] LanguageTool request timed out')
      return []
    }
    logger?.error(`[spellcheck] LanguageTool error: ${error instanceof Error ? error.message : error}`)
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
    contextOffset: m.context.offset,
    offset: m.offset,
    length: m.length,
    original: m.context.text.slice(m.context.offset, m.context.offset + m.context.length),
    replacements: m.replacements.slice(0, 3).map((r) => r.value),
    source: 'languagetool' as const,
    isPremium: m.rule.isPremium ?? false,
  }))
}
