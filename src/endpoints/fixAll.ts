/**
 * Fix All endpoint — apply ALL non-ignored fixes for a document sequentially.
 * POST /api/spellcheck/fix-all
 * Body: { id, collection }
 *
 * Loads existing spellcheck results, then applies each fix one-by-one using
 * the shared fixCore logic (no HTTP self-call), walking the document from the
 * LAST offset to the first so that a length-changing replacement never
 * invalidates the offsets still to be processed.
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig, SpellCheckIssue } from '../types.js'
import { applyFix } from './fixCore.js'
import { recheckDocument } from '../utils/recheck.js'
import { createAccessGuard } from './access.js'

export interface FixAllResult {
  /** Number of fixes successfully applied */
  applied: number
  /** Number of fixes that failed */
  failed: number
  /** Details for each fix attempt */
  details: { original: string; replacement: string; success: boolean }[]
  /** Whether the stored spellcheck result was refreshed after the batch */
  rechecked?: boolean
}

export function createFixAllHandler(
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  const guard = createAccessGuard(pluginConfig)
  return async (req) => {
    try {
      // RBAC: check access (default: admin only)
      if (!guard.isAllowed(req)) return guard.forbidden()

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

      // Validate collection against allowed list to prevent injection
      const allowedCollections = pluginConfig.collections ?? ['pages', 'posts']
      if (!allowedCollections.includes(collection)) {
        return Response.json({ error: 'Collection not allowed' }, { status: 403 })
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

      // Only process issues that have at least one replacement suggestion, and
      // that come from LanguageTool.
      //
      // Claude issues are excluded on purpose: they are semantic remarks whose
      // `original`/`suggestion` pair is produced by a model that has just read
      // the document, i.e. text an author (or an imported feed) can influence.
      // Replaying them unattended would let content choose the string written
      // into a published document under an admin's "fix everything" click.
      // They stay visible in the dashboard and applicable one by one, where a
      // human sees what is being replaced.
      const fixableIssues = issues.filter(
        (issue) => issue.replacements.length > 0 && issue.source !== 'claude',
      )

      if (fixableIssues.length === 0) {
        return Response.json({
          applied: 0,
          failed: 0,
          details: [],
        } satisfies FixAllResult)
      }

      const details: FixAllResult['details'] = new Array(fixableIssues.length)
      let applied = 0
      let failed = 0

      // Every offset here was computed on the text BEFORE any correction, and
      // applyFix re-reads the document from the database at each iteration. A
      // replacement whose length differs from the original — the norm in French
      // (accents, doubled consonants) — shifts every offset AFTER it, so in
      // document order the second fix already misses its target and `strict`
      // rejects it: "Fix all" applied exactly one mistake per click.
      // Walking the document BACKWARDS keeps the remaining (lower) offsets
      // valid, since a replacement never moves the text that precedes it.
      const ordered = fixableIssues
        .map((issue, index) => ({ issue, index }))
        .sort((a, b) => b.issue.offset - a.issue.offset)

      // Apply fixes one-by-one using the shared core logic (no HTTP self-call)
      for (const { issue, index } of ordered) {
        const replacement = issue.replacements[0]
        try {
          const fixResult = await applyFix(
            req.payload,
            {
              id,
              collection,
              original: issue.original,
              replacement,
              offset: issue.offset,
              length: issue.length,
              // Batch mode: no heuristic fallback. A stale offset must not make
              // us rewrite some OTHER occurrence of the word — nobody reviews
              // the individual edits of a "fix everything" click.
              strict: true,
            },
            pluginConfig,
            req.payload.logger,
          )

          if (fixResult.success) {
            applied++
            details[index] = { original: issue.original, replacement, success: true }
          } else {
            failed++
            details[index] = { original: issue.original, replacement, success: false }
          }
        } catch {
          failed++
          details[index] = { original: issue.original, replacement, success: false }
        }
      }

      // Single re-check after the batch. Each fix wrote with
      // `context.skipSpellcheck`, so without this the stored issues would stay
      // frozen on the pre-correction state and the dashboard would keep showing
      // mistakes that no longer exist.
      let rechecked = false
      if (applied > 0) {
        try {
          const refreshed = await req.payload.find({
            collection,
            where: { id: { equals: id } },
            limit: 1,
            depth: 0,
            draft: true,
            overrideAccess: true,
          })
          if (refreshed.docs.length) {
            const outcome = await recheckDocument(req.payload, collection, refreshed.docs[0], pluginConfig)
            rechecked = outcome.ok
            if (!outcome.ok) {
              req.payload.logger.warn(`[spellcheck/fix-all] Re-check skipped: ${outcome.reason}`)
            }
          }
        } catch (err) {
          req.payload.logger.warn(
            `[spellcheck/fix-all] Re-check failed: ${err instanceof Error ? err.message : err}`,
          )
        }
      }

      const result: FixAllResult = { applied, failed, details, rechecked }
      return Response.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/fix-all] Error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
