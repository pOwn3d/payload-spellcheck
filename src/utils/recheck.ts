/**
 * Shared "check this document and store the result" pipeline.
 *
 * Used by the afterChange hook and by /fix-all (one single re-check after the
 * whole batch, instead of one full LanguageTool round-trip per corrected word).
 */

import type { Payload } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { extractAllTextFromDoc, countWords } from '../engine/lexicalParser.js'
import { runLanguageToolCheck } from '../engine/languagetool.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'
import { upsertSpellcheckResult, findSpellcheckResult } from './upsertResult.js'
import { filterIgnoredIssues, type IgnoredIssue } from './filterIgnored.js'

export type RecheckOutcome =
  | { ok: true; score: number; issueCount: number; skipped?: 'empty' }
  | { ok: false; reason: string }

/**
 * Run the spellcheck pipeline on an already-loaded document and persist the
 * result. Returns `ok: false` when the engine could not be reached — in that
 * case NOTHING is written, so a previous result holding real mistakes is never
 * replaced by a fake "100/100, 0 issue".
 */
export async function recheckDocument(
  payload: Payload,
  collectionSlug: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  pluginConfig: SpellCheckPluginConfig,
): Promise<RecheckOutcome> {
  const contentField = pluginConfig.contentField || 'content'
  const language = pluginConfig.language || 'fr'

  const text = extractAllTextFromDoc(doc, contentField)
  if (!text.trim()) return { ok: true, score: 100, issueCount: 0, skipped: 'empty' }

  const wordCount = countWords(text)

  const outcome = await runLanguageToolCheck(text, language, pluginConfig, payload.logger)
  if (!outcome.ok) return { ok: false, reason: outcome.reason }

  let issues = await filterFalsePositives(outcome.issues, pluginConfig, payload)

  const existingDoc = await findSpellcheckResult(payload, String(doc.id), collectionSlug)
  const ignoredIssues: IgnoredIssue[] = Array.isArray(existingDoc?.ignoredIssues)
    ? existingDoc.ignoredIssues
    : []

  issues = filterIgnoredIssues(issues, ignoredIssues)

  const score = calculateScore(wordCount, issues.length)

  await upsertSpellcheckResult(payload, String(doc.id), collectionSlug, {
    title: doc.title || '',
    slug: doc.slug || '',
    score,
    issueCount: issues.length,
    wordCount,
    issues: issues as unknown as Record<string, unknown>[],
    ignoredIssues: ignoredIssues as unknown as Record<string, unknown>[],
    lastChecked: new Date().toISOString(),
  })

  return { ok: true, score, issueCount: issues.length }
}
