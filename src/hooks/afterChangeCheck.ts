/**
 * afterChange hook — fire-and-forget spellcheck on document save.
 * Pattern: autoAltText.ts (IIFE, non-blocking).
 */

import type { CollectionAfterChangeHook } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { extractAllTextFromDoc, countWords } from '../engine/lexicalParser.js'
import { checkWithLanguageTool } from '../engine/languagetool.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'

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
        const existing = await req.payload.find({
          collection: 'spellcheck-results',
          where: {
            docId: { equals: String(doc.id) },
            collection: { equals: collectionSlug },
          },
          limit: 1,
          overrideAccess: true,
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingDoc = existing.docs.length > 0 ? (existing.docs[0] as any) : null
        const ignoredIssues: Array<{ ruleId: string; original: string }> = Array.isArray(existingDoc?.ignoredIssues) ? existingDoc.ignoredIssues : []

        // Filter out user-ignored issues
        if (ignoredIssues.length > 0) {
          issues = issues.filter((issue) =>
            !ignoredIssues.some((ignored) => ignored.ruleId === issue.ruleId && ignored.original === issue.original),
          )
        }

        const score = calculateScore(wordCount, issues.length)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const docAny = doc as any
        const resultData = {
          docId: String(doc.id),
          collection: collectionSlug,
          title: docAny.title || '',
          slug: docAny.slug || '',
          score,
          issueCount: issues.length,
          wordCount,
          issues: issues as unknown as Record<string, unknown>[],
          ignoredIssues: ignoredIssues as unknown as Record<string, unknown>[],
          lastChecked: new Date().toISOString(),
        }

        if (existingDoc) {
          await req.payload.update({
            collection: 'spellcheck-results',
            id: existingDoc.id,
            data: resultData,
            overrideAccess: true,
          })
        } else {
          await req.payload.create({
            collection: 'spellcheck-results',
            data: resultData,
            overrideAccess: true,
          })
        }

        console.log(`[spellcheck] Auto-check: ${collectionSlug}/${doc.id} — score ${score}, ${issues.length} issues`)
      } catch (err) {
        console.error('[spellcheck] afterChange hook error:', err)
      }
    })()

    return doc
  }
}
