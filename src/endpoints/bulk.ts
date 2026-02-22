/**
 * Bulk endpoint — scan all documents in configured collections.
 * POST /api/spellcheck/bulk
 * Body: { collection? } — if no collection, scans all configured collections.
 *
 * Sequential processing to respect LanguageTool rate limits (3s between requests).
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig, SpellCheckResult } from '../types.js'
import { extractTextFromLexical, countWords } from '../engine/lexicalParser.js'
import { checkWithLanguageTool } from '../engine/languagetool.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'

const RATE_LIMIT_DELAY = 3_000 // 3 seconds between LanguageTool API calls

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Extract text from a document (same logic as validate endpoint).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(doc: any, contentField: string): string {
  let text = ''
  if (doc.title) text += doc.title + '\n'
  if (doc.hero?.richText) text += extractTextFromLexical(doc.hero.richText) + '\n'
  if (doc[contentField]) text += extractTextFromLexical(doc[contentField]) + '\n'
  if (Array.isArray(doc.layout)) {
    for (const block of doc.layout) {
      if (block.richText) text += extractTextFromLexical(block.richText) + '\n'
      if (Array.isArray(block.columns)) {
        for (const col of block.columns) {
          if (col.richText) text += extractTextFromLexical(col.richText) + '\n'
        }
      }
    }
  }
  return text.trim()
}

export function createBulkHandler(
  targetCollections: string[],
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json().catch(() => ({}))
      const { collection: targetCollection, ids } = body as {
        collection?: string
        ids?: Array<{ id: string; collection: string }>
      }

      // If specific IDs are provided, scan only those
      const scanSpecificIds = Array.isArray(ids) && ids.length > 0

      const collectionsToScan = scanSpecificIds
        ? [...new Set(ids!.map((i) => i.collection))]
        : targetCollection
          ? [targetCollection]
          : targetCollections

      const language = pluginConfig.language || 'fr'
      const contentField = pluginConfig.contentField || 'content'
      const results: SpellCheckResult[] = []
      let totalDocuments = 0
      let totalIssues = 0

      for (const collectionSlug of collectionsToScan) {
        // Build IDs filter for this collection if scanning specific docs
        const idsForCollection = scanSpecificIds
          ? ids!.filter((i) => i.collection === collectionSlug).map((i) => i.id)
          : null

        // Fetch documents
        const allDocs = await req.payload.find({
          collection: collectionSlug,
          limit: 0, // Get all
          depth: 1,
          overrideAccess: true,
          where: {
            ...(idsForCollection
              ? { id: { in: idsForCollection } }
              : { _status: { equals: 'published' } }),
          },
        })

        for (const doc of allDocs.docs) {
          totalDocuments++
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const docAny = doc as any
          const text = extractText(docAny, contentField)

          if (!text.trim()) continue

          const wordCount = countWords(text)

          // Check with LanguageTool
          let issues = await checkWithLanguageTool(text, language, pluginConfig)
          issues = filterFalsePositives(issues, pluginConfig)

          const score = calculateScore(wordCount, issues.length)
          totalIssues += issues.length

          const result: SpellCheckResult = {
            docId: String(doc.id),
            collection: collectionSlug,
            score,
            issueCount: issues.length,
            wordCount,
            issues,
            lastChecked: new Date().toISOString(),
          }
          results.push(result)

          // Store/update result in collection
          try {
            const existing = await req.payload.find({
              collection: 'spellcheck-results',
              where: {
                docId: { equals: String(doc.id) },
                collection: { equals: collectionSlug },
              },
              limit: 1,
              overrideAccess: true,
            })

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
          } catch (err) {
            console.error('[spellcheck/bulk] Failed to store result:', err)
          }

          // Rate limit delay
          await sleep(RATE_LIMIT_DELAY)
        }
      }

      return Response.json({
        totalDocuments,
        totalIssues,
        averageScore: results.length > 0
          ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
          : 100,
        results,
      })
    } catch (error) {
      console.error('[spellcheck/bulk] Error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
