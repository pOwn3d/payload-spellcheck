/**
 * Fix All endpoint — apply ALL non-ignored fixes for a document sequentially.
 * POST /api/spellcheck/fix-all
 * Body: { id, collection }
 *
 * Loads existing spellcheck results, applies each fix one-by-one (re-fetching
 * the doc each time to account for offset shifts from previous fixes),
 * and returns a summary of applied/failed fixes.
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig, SpellCheckIssue } from '../types.js'

export interface FixAllResult {
  /** Number of fixes successfully applied */
  applied: number
  /** Number of fixes that failed */
  failed: number
  /** Details for each fix attempt */
  details: { original: string; replacement: string; success: boolean }[]
}

export function createFixAllHandler(
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json().catch(() => ({}))
      const { id, collection } = body as {
        id?: string | number
        collection?: string
      }

      if (!id || !collection) {
        return Response.json(
          { error: 'Missing required fields: id, collection' },
          { status: 400 },
        )
      }

      // Load existing spellcheck results for this document
      const existingResults = await req.payload.find({
        collection: 'spellcheck-results',
        where: {
          docId: { equals: String(id) },
          collection: { equals: collection },
        },
        limit: 1,
        overrideAccess: true,
      })

      if (!existingResults.docs.length) {
        return Response.json(
          { error: 'No spellcheck results found for this document. Run a check first.' },
          { status: 404 },
        )
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultDoc = existingResults.docs[0] as any
      const issues: SpellCheckIssue[] = Array.isArray(resultDoc.issues) ? resultDoc.issues : []

      if (issues.length === 0) {
        return Response.json({
          applied: 0,
          failed: 0,
          details: [],
        } satisfies FixAllResult)
      }

      // Only process issues that have at least one replacement suggestion
      const fixableIssues = issues.filter((issue) => issue.replacements.length > 0)

      if (fixableIssues.length === 0) {
        return Response.json({
          applied: 0,
          failed: 0,
          details: [],
        } satisfies FixAllResult)
      }

      const details: FixAllResult['details'] = []
      let applied = 0
      let failed = 0

      // Apply fixes one-by-one, calling the fix endpoint logic for each
      // We re-use the internal fix API to ensure consistent behavior
      for (const issue of fixableIssues) {
        const replacement = issue.replacements[0]
        try {
          const fixRes = await fetch(
            `${req.headers.get('origin') || ''}/api/spellcheck/fix`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Cookie: req.headers.get('cookie') || '',
              },
              body: JSON.stringify({
                id,
                collection,
                original: issue.original,
                replacement,
                offset: issue.offset,
                length: issue.length,
              }),
            },
          )

          if (fixRes.ok) {
            const fixData = await fixRes.json()
            if (fixData.success) {
              applied++
              details.push({ original: issue.original, replacement, success: true })
            } else {
              failed++
              details.push({ original: issue.original, replacement, success: false })
            }
          } else {
            failed++
            details.push({ original: issue.original, replacement, success: false })
          }
        } catch {
          failed++
          details.push({ original: issue.original, replacement, success: false })
        }
      }

      const result: FixAllResult = { applied, failed, details }
      return Response.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/fix-all] Error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
