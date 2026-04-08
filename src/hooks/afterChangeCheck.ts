/**
 * afterChange hook — fire-and-forget spellcheck on document save.
 * Pattern: autoAltText.ts (IIFE, non-blocking).
 */

import type { CollectionAfterChangeHook } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { extractAllTextFromDoc, countWords } from '../engine/lexicalParser.js'
import { checkWithLanguageTool } from '../engine/languagetool.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'
import { upsertSpellcheckResult, findSpellcheckResult } from '../utils/upsertResult.js'
import { filterIgnoredIssues, type IgnoredIssue } from '../utils/filterIgnored.js'

export function createAfterChangeCheckHook(
  pluginConfig: SpellCheckPluginConfig,
): CollectionAfterChangeHook {
  return ({ doc, collection, req }) => {
    // Fire-and-forget IIFE — does NOT block the save
    ;(async () => {
      try {
        const contentField = pluginConfig.contentField || 'content'
        const language = pluginConfig.language || 'fr'

        // Extract text from all document fields
        const text = extractAllTextFromDoc(doc, contentField)
        if (!text) return

        const wordCount = countWords(text)
        let issues = await checkWithLanguageTool(text, language, pluginConfig)
        issues = await filterFalsePositives(issues, pluginConfig, req.payload)

        const collectionSlug = typeof collection === 'string'
          ? collection
          : (collection as { slug: string }).slug

        // Load existing result to get ignoredIssues
        const existingDoc = await findSpellcheckResult(req.payload, String(doc.id), collectionSlug)
        const ignoredIssues: IgnoredIssue[] = Array.isArray(existingDoc?.ignoredIssues) ? existingDoc.ignoredIssues : []

        // Filter out user-ignored issues
        issues = filterIgnoredIssues(issues, ignoredIssues)

        const score = calculateScore(wordCount, issues.length)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const docAny = doc as any
        await upsertSpellcheckResult(req.payload, String(doc.id), collectionSlug, {
          title: docAny.title || '',
          slug: docAny.slug || '',
          score,
          issueCount: issues.length,
          wordCount,
          issues: issues as unknown as Record<string, unknown>[],
          ignoredIssues: ignoredIssues as unknown as Record<string, unknown>[],
          lastChecked: new Date().toISOString(),
        })

        req.payload.logger.info(`[spellcheck] Auto-check: ${collectionSlug}/${doc.id} — score ${score}, ${issues.length} issues`)
      } catch (err) {
        req.payload.logger.error(`[spellcheck] afterChange hook error: ${err instanceof Error ? err.message : err}`)
      }
    })()

    return doc
  }
}
