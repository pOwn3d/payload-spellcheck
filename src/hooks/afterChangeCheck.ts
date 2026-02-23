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
        issues = filterFalsePositives(issues, pluginConfig)
        const score = calculateScore(wordCount, issues.length)

        const collectionSlug = typeof collection === 'string'
          ? collection
          : (collection as { slug: string }).slug

        // Upsert result
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
          lastChecked: new Date().toISOString(),
        }

        if (existing.docs.length > 0) {
          await req.payload.update({
            collection: 'spellcheck-results',
            id: existing.docs[0].id,
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
