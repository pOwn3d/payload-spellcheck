/**
 * afterChange hook — fire-and-forget spellcheck on document save.
 * Pattern: autoAltText.ts (IIFE, non-blocking).
 */

import type { CollectionAfterChangeHook } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { recheckDocument } from '../utils/recheck.js'

/**
 * Should this save be skipped?
 *
 * Two loops to break:
 *  - `context.skipSpellcheck` — set by our own /fix and /fix-all writes, which
 *    would otherwise fire a fresh LanguageTool request per corrected word.
 *  - autosave — the editor autosaves while typing; each tick used to ship the
 *    whole document (up to 18 000 characters) to LanguageTool. On the free API
 *    (1 req / 3 s) those requests fail in cascade, and a failed check used to
 *    be stored as a perfect score.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shouldSkip(context: any, req: any): boolean {
  if (context?.skipSpellcheck || req?.context?.skipSpellcheck) return true
  const autosave = req?.query?.autosave
  return autosave === true || autosave === 'true'
}

export function createAfterChangeCheckHook(
  pluginConfig: SpellCheckPluginConfig,
): CollectionAfterChangeHook {
  return ({ doc, collection, req, context }) => {
    if (shouldSkip(context, req)) return doc

    // Fire-and-forget IIFE — does NOT block the save
    ;(async () => {
      try {
        const collectionSlug = typeof collection === 'string'
          ? collection
          : (collection as { slug: string }).slug

        const outcome = await recheckDocument(req.payload, collectionSlug, doc, pluginConfig)

        if (!outcome.ok) {
          // Stay silent for the editor, but leave a trace: writing a fake
          // "100/100, 0 issue" over the stored result is worse than no update.
          req.payload.logger.warn(
            `[spellcheck] Auto-check skipped for ${collectionSlug}/${doc.id}: ${outcome.reason}`,
          )
          return
        }

        if (outcome.skipped === 'empty') return

        req.payload.logger.info(
          `[spellcheck] Auto-check: ${collectionSlug}/${doc.id} — score ${outcome.score}, ${outcome.issueCount} issues`,
        )
      } catch (err) {
        req.payload.logger.error(`[spellcheck] afterChange hook error: ${err instanceof Error ? err.message : err}`)
      }
    })()

    return doc
  }
}
