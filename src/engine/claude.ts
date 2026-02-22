/**
 * Claude AI semantic analysis (optional fallback).
 * Checks for semantic coherence, tone consistency, and register issues.
 * Does NOT check spelling/grammar (LanguageTool handles that).
 */

import type { SpellCheckIssue } from '../types.js'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const REQUEST_TIMEOUT = 60_000
const MAX_TEXT_LENGTH = 8_000

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>
}

interface ClaudeIssue {
  message: string
  context: string
  original: string
  suggestion: string
  category: string
}

/**
 * Check text with Claude API for semantic issues.
 * Returns SpellCheckIssue[] with source='claude'.
 */
export async function checkWithClaude(
  text: string,
  language: string,
  apiKey: string,
): Promise<SpellCheckIssue[]> {
  if (!text.trim() || !apiKey) return []

  const truncatedText = text.length > MAX_TEXT_LENGTH
    ? text.slice(0, MAX_TEXT_LENGTH)
    : text

  const langLabel = language === 'fr' ? 'French' : 'English'

  const prompt = `Analyze this ${langLabel} web content for semantic issues ONLY (NOT spelling/grammar — a separate tool handles that). Check for:
1. Inconsistent tone or register (formal vs informal mixing)
2. Incoherent statements or contradictions
3. Awkward phrasing that a spellchecker wouldn't catch
4. Missing words that change meaning

Return a JSON array of issues found. Each issue: { "message": "...", "context": "10-word excerpt around issue", "original": "problematic phrase", "suggestion": "improved version", "category": "COHERENCE|TONE|PHRASING|MISSING_WORD" }

Return [] if no issues found. Be strict — only flag clear problems, not style preferences.

Text:
${truncatedText}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error(`[spellcheck] Claude API error: ${response.status}`)
      return []
    }

    const data = (await response.json()) as ClaudeResponse
    const responseText = data.content?.[0]?.text || '[]'

    // Extract JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const issues: ClaudeIssue[] = JSON.parse(jsonMatch[0])
    return issues.map((issue) => ({
      ruleId: `CLAUDE_${issue.category}`,
      category: issue.category,
      message: issue.message,
      context: issue.context,
      offset: 0,
      length: issue.original.length,
      original: issue.original,
      replacements: issue.suggestion ? [issue.suggestion] : [],
      source: 'claude' as const,
    }))
  } catch (error) {
    clearTimeout(timeoutId)
    console.error('[spellcheck] Claude error:', error)
    return []
  }
}
