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
 * Outcome of a LanguageTool call.
 *
 * A failed check MUST NOT be confused with "no mistakes found": returning an
 * empty array on a 429/timeout/5xx made calculateScore() report 100/100 and
 * that perfect score was then written over a stored result that held real
 * issues. Callers have to branch on `ok`.
 */
export type LanguageToolOutcome =
  | { ok: true; issues: SpellCheckIssue[] }
  | { ok: false; reason: string }

/**
 * Check text with LanguageTool API.
 * Returns a discriminated outcome — prefer this over checkWithLanguageTool().
 */
export async function runLanguageToolCheck(
  text: string,
  language: string,
  config: SpellCheckPluginConfig,
  logger?: { error: (msg: string) => void },
): Promise<LanguageToolOutcome> {
  if (!text.trim()) return { ok: true, issues: [] }

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
    return { ok: true, issues: parseMatches(data.matches || []) }
  } catch (error) {
    clearTimeout(timeoutId)
    if ((error as Error).name === 'AbortError') {
      const reason = `LanguageTool request timed out after ${requestTimeout}ms`
      logger?.error(`[spellcheck] ${reason}`)
      return { ok: false, reason }
    }
    const reason = error instanceof Error ? error.message : String(error)
    logger?.error(`[spellcheck] LanguageTool error: ${reason}`)
    return { ok: false, reason }
  }
}

/**
 * Backwards-compatible wrapper: returns [] when the check fails.
 *
 * @deprecated Use runLanguageToolCheck() — an empty array here is
 * indistinguishable from "the text is clean", which silently turns an API
 * outage into a perfect score.
 */
export async function checkWithLanguageTool(
  text: string,
  language: string,
  config: SpellCheckPluginConfig,
  logger?: { error: (msg: string) => void },
): Promise<SpellCheckIssue[]> {
  const outcome = await runLanguageToolCheck(text, language, config, logger)
  return outcome.ok ? outcome.issues : []
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
