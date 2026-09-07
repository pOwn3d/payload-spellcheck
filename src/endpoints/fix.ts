/**
 * Fix endpoint — apply a spelling correction at a precise offset in the document.
 *
 * POST /api/spellcheck/fix
 * Body: { id, collection, original, replacement, offset?, length?, field? }
 *
 * Delegates to fixCore.applyFix() for the actual fix logic.
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { applyFix } from './fixCore.js'
import { realignStoredResult } from '../utils/realignIssues.js'
import { createAccessGuard } from './access.js'

export function createFixHandler(
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  const guard = createAccessGuard(pluginConfig)
  return async (req) => {
    try {
      // RBAC: check access (default: admin only)
      if (!guard.isAllowed(req)) return guard.forbidden()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json()
      const { id, collection, original, replacement, offset, length, field } = body as {
        id: string | number
        collection: string
        original: string
        replacement: string
        offset?: number
        length?: number
        field?: string
      }

      if (!id || !collection || !original || replacement === undefined) {
        return Response.json(
          { error: 'Missing required fields: id, collection, original, replacement' },
          { status: 400 },
        )
      }

      // Validate collection against allowed list to prevent injection
      const allowedCollections = pluginConfig.collections ?? ['pages', 'posts']
      if (!allowedCollections.includes(collection)) {
        return Response.json({ error: 'Collection not allowed' }, { status: 403 })
      }

      // Input validation
      if (typeof collection !== 'string' || !collection.trim()) {
        return Response.json({ error: 'collection must be a non-empty string' }, { status: 400 })
      }
      if (typeof id !== 'string' && typeof id !== 'number' || !String(id).trim()) {
        return Response.json({ error: 'id must be a non-empty string' }, { status: 400 })
      }

      const result = await applyFix(
        req.payload,
        { id, collection, original, replacement, offset, length, field },
        pluginConfig,
        req.payload.logger,
      )

      // The write above carries `context: { skipSpellcheck: true }`, so the
      // afterChange hook will NOT refresh the stored result: every issue still
      // recorded for this document keeps an offset computed before this
      // correction. Left alone, the next "Fix all" — which is strict on
      // purpose — rejects all of them. Re-align them from the applied span
      // instead of paying a full LanguageTool round-trip per clicked word.
      if (result.success && typeof result.appliedOffset === 'number') {
        try {
          await realignStoredResult(req.payload, collection, String(id), {
            offset: result.appliedOffset,
            length: result.appliedLength ?? original.length,
            replacementLength: replacement.length,
          })
        } catch (err) {
          req.payload.logger.warn(
            `[spellcheck/fix] Could not re-align stored issues: ${err instanceof Error ? err.message : err}`,
          )
        }
      }

      return Response.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/fix] Error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
