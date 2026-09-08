/**
 * Payload CMS Spellcheck Plugin.
 *
 * Adds spellchecking capabilities via LanguageTool + optional Claude AI:
 * - Sidebar field in the editor (real-time spellcheck)
 * - Dashboard view at /admin/spellcheck
 * - API endpoints for validate, fix, bulk scan
 * - afterChange hook for automatic checks on save
 * - SpellCheckResults collection for storing results
 *
 * Usage:
 *   import { spellcheckPlugin } from '@consilioweb/payload-spellcheck'
 *
 *   export default buildConfig({
 *     plugins: [
 *       spellcheckPlugin({ collections: ['pages', 'posts'] }),
 *     ],
 *   })
 */

import type { Config, Plugin } from 'payload'
import type { SpellCheckPluginConfig } from './types.js'
import { createSpellCheckResultsCollection } from './collections/SpellCheckResults.js'
import { createSpellCheckDictionaryCollection } from './collections/SpellCheckDictionary.js'
import { createValidateHandler } from './endpoints/validate.js'
import { createFixHandler } from './endpoints/fix.js'
import { createFixAllHandler } from './endpoints/fixAll.js'
import { createBulkHandler, createStatusHandler } from './endpoints/bulk.js'
import { createDictionaryListHandler, createDictionaryAddHandler, createDictionaryDeleteHandler } from './endpoints/dictionary.js'
import { createRateLimiter, getClientIp, rateLimitResponse } from './endpoints/rateLimit.js'
import { createAccessGuard } from './endpoints/access.js'
import { createAfterChangeCheckHook } from './hooks/afterChangeCheck.js'

/**
 * Auto-fix schema issues caused by Payload's `push:true` not adding
 * foreign key columns to `payload_locked_documents_rels` for new collections.
 * Runs once on init — detects missing columns and adds them automatically.
 *
 * Works with SQLite (better-sqlite3) via raw client. For Postgres, logs
 * a warning with the manual ALTER TABLE command.
 */
async function autoFixSchema(payload: any): Promise<void> {
  try {
    // Test if the dictionary collection is queryable
    await payload.find({ collection: 'spellcheck-dictionary', limit: 1, overrideAccess: true })
  } catch (e: any) {
    const msg = String(e?.message || '')
    if (!msg.includes('no such column') && !msg.includes('spellcheck_dictionary')) return

    payload.logger.info('[spellcheck] Detected missing schema column, attempting auto-fix...')

    const alterSQL = 'ALTER TABLE payload_locked_documents_rels ADD COLUMN spellcheck_dictionary_id integer'
    const db = payload.db as any

    // Find raw SQLite client (multiple paths depending on Payload/adapter version)
    const rawClient = db.pool || db.client || db.drizzle?.session?.client

    if (!rawClient?.exec) {
      payload.logger.warn(`[spellcheck] Auto-fix: could not access raw DB client. Run manually: ${alterSQL}`)
      return
    }

    try {
      rawClient.exec(alterSQL)
      payload.logger.info('[spellcheck] Auto-fixed: added spellcheck_dictionary_id to payload_locked_documents_rels')
    } catch (fixErr: any) {
      const fixMsg = String(fixErr?.message || '')
      if (fixMsg.includes('duplicate column') || fixMsg.includes('already exists')) return
      payload.logger.warn(`[spellcheck] Auto-fix failed: ${fixMsg}. Run manually: ${alterSQL}`)
    }
  }
}

export const spellcheckPlugin =
  (pluginConfig: SpellCheckPluginConfig = {}): Plugin =>
  (incomingConfig: Config): Config => {
    const config = { ...incomingConfig }
    const targetCollections = pluginConfig.collections ?? ['pages', 'posts']
    const basePath = pluginConfig.endpointBasePath ?? '/spellcheck'
    const checkOnSave = pluginConfig.checkOnSave !== false
    const addSidebarField = pluginConfig.addSidebarField !== false
    const addDashboardView = pluginConfig.addDashboardView !== false
    const pkgName = pluginConfig.packageName || '@consilioweb/payload-spellcheck'
    const accessGuard = createAccessGuard(pluginConfig)

    // 1. Add afterChange hook + sidebar field to target collections
    if (config.collections) {
      config.collections = config.collections.map((collection) => {
        if (!targetCollections.includes(collection.slug)) return collection

        const updated = { ...collection }

        // Add afterChange hook for auto-check on save
        if (checkOnSave) {
          const existingHooks = updated.hooks?.afterChange || []
          updated.hooks = {
            ...updated.hooks,
            afterChange: [
              ...(Array.isArray(existingHooks) ? existingHooks : [existingHooks]),
              createAfterChangeCheckHook(pluginConfig),
            ],
          }
        }

        // Add sidebar field
        if (addSidebarField) {
          updated.fields = [
            ...(updated.fields || []),
            {
              name: '_spellcheck',
              type: 'ui',
              admin: {
                position: 'sidebar',
                components: {
                  Field: `${pkgName}/client#SpellCheckField`,
                },
              },
            },
          ]
        }

        // Add score column in list view
        if (pluginConfig.addListColumn !== false) {
          updated.fields = [
            ...(updated.fields || []),
            {
              name: '_spellcheckScore',
              type: 'ui',
              label: 'Ortho',
              admin: {
                components: {
                  Cell: `${pkgName}/client#SpellCheckScoreCell`,
                },
              },
            },
          ]

          // Add to defaultColumns if defined
          if (updated.admin?.defaultColumns) {
            const cols = [...updated.admin.defaultColumns]
            if (!cols.includes('_spellcheckScore')) {
              cols.push('_spellcheckScore')
            }
            updated.admin = { ...updated.admin, defaultColumns: cols }
          }
        }

        return updated
      })
    }

    // 2. Add SpellCheckResults + SpellCheckDictionary collections
    config.collections = [
      ...(config.collections || []),
      createSpellCheckResultsCollection(pluginConfig),
      createSpellCheckDictionaryCollection(pluginConfig),
    ]

    // 3. Add API endpoints (with per-endpoint rate limiting)
    // `trustProxy` was documented but never read: getClientIp() defaulted to
    // trusting x-forwarded-for whatever the config said. Honour it here.
    const trustProxy = pluginConfig.trustProxy !== false
    const clientIp = (req: { headers: Headers }): string => getClientIp(req, trustProxy)

    /**
     * Rate-limiter key. The limiter now runs AFTER the access guard, so there
     * is always an authenticated user: key on the account rather than on the
     * caller-supplied `X-Forwarded-For`. That removes both abuses the header
     * allowed — one Map entry per forged IP (unbounded growth), and filling a
     * legitimate admin's bucket by forging their IP. The IP remains the
     * fallback for the (unreachable over HTTP) case of a user without an id.
     */
    const rateLimitKey = (req: {
      headers: Headers
      user?: unknown
    }): string => {
      const u = req.user as { id?: unknown; collection?: unknown } | null | undefined
      if (u && (typeof u.id === 'string' || typeof u.id === 'number')) {
        return `user:${typeof u.collection === 'string' ? u.collection : ''}:${u.id}`
      }
      return `ip:${clientIp(req)}`
    }

    /**
     * Wrap a handler with "access first, rate limit second".
     *
     * The order matters: while the limiter ran first, an anonymous caller could
     * create an unbounded number of Map entries and evict an admin's quota
     * without ever holding an account. The guard is re-evaluated inside each
     * handler too — it is a pure function of the request, so running it twice
     * costs nothing and keeps the handlers usable on their own.
     */
    const guarded = (
      limiter: { check: (key: string) => boolean },
      handler: import('payload').PayloadHandler,
    ): import('payload').PayloadHandler =>
      (async (req) => {
        if (!accessGuard.isAllowed(req)) return accessGuard.forbidden()
        if (!limiter.check(rateLimitKey(req))) return rateLimitResponse()
        return handler(req)
      }) as import('payload').PayloadHandler

    const rl = pluginConfig.rateLimits ?? {}
    const windowMs = rl.windowMs ?? 60_000
    const validateLimiter = createRateLimiter(rl.validate ?? 30, windowMs)
    const fixLimiter = createRateLimiter(rl.fix ?? 20, windowMs)
    const bulkLimiter = createRateLimiter(rl.bulk ?? 3, windowMs)
    // /status has its own budget: the dashboard polls it every 2 s during a
    // scan, so sharing bulkLimiter (3 req/min) burned the budget in ~6 s and
    // the UI then never saw the 'completed' transition.
    const statusLimiter = createRateLimiter(rl.status ?? 60, windowMs)
    const dictionaryLimiter = createRateLimiter(rl.dictionary ?? 60, windowMs)
    const fixAllLimiter = createRateLimiter(rl.fixAll ?? 5, windowMs)

    const validateHandler = createValidateHandler(pluginConfig)
    const fixHandler = createFixHandler(pluginConfig)
    const fixAllHandler = createFixAllHandler(pluginConfig)
    const bulkHandler = createBulkHandler(targetCollections, pluginConfig)
    const statusHandler = createStatusHandler(pluginConfig)
    const dictListHandler = createDictionaryListHandler(pluginConfig)
    const dictAddHandler = createDictionaryAddHandler(pluginConfig)
    const dictDeleteHandler = createDictionaryDeleteHandler(pluginConfig)

    config.endpoints = [
      ...(config.endpoints || []),
      {
        path: `${basePath}/validate`,
        method: 'post' as const,
        handler: guarded(validateLimiter, validateHandler),
      },
      {
        path: `${basePath}/fix`,
        method: 'post' as const,
        handler: guarded(fixLimiter, fixHandler),
      },
      {
        path: `${basePath}/fix-all`,
        method: 'post' as const,
        handler: guarded(fixAllLimiter, fixAllHandler),
      },
      {
        path: `${basePath}/bulk`,
        method: 'post' as const,
        handler: guarded(bulkLimiter, bulkHandler),
      },
      {
        path: `${basePath}/status`,
        method: 'get' as const,
        handler: guarded(statusLimiter, statusHandler),
      },
      {
        path: `${basePath}/dictionary`,
        method: 'get' as const,
        handler: guarded(dictionaryLimiter, dictListHandler),
      },
      {
        path: `${basePath}/dictionary`,
        method: 'post' as const,
        handler: guarded(dictionaryLimiter, dictAddHandler),
      },
      {
        path: `${basePath}/dictionary`,
        method: 'delete' as const,
        handler: guarded(dictionaryLimiter, dictDeleteHandler),
      },
      {
        path: `${basePath}/collections`,
        method: 'get' as const,
        handler: (async (req) => {
          if (!accessGuard.isAllowed(req)) return accessGuard.forbidden()
          return Response.json({ collections: targetCollections })
        }) as import('payload').PayloadHandler,
      },
    ]

    // 4. Add dashboard view
    // Expose the resolved access check on config.custom so the (server-rendered)
    // dashboard view can gate itself the same way the endpoints do. Registered
    // views are referenced by path string, so this is the only channel through
    // which they can see the plugin options.
    config.custom = {
      ...(config.custom || {}),
      spellcheck: {
        ...((config.custom?.spellcheck as Record<string, unknown>) || {}),
        isAllowed: (req: { user?: unknown }) => accessGuard.isAllowed(req),
      },
    }

    if (addDashboardView) {
      if (!config.admin) config.admin = {}
      if (!config.admin.components) config.admin.components = {}
      if (!config.admin.components.views) config.admin.components.views = {}

      ;(config.admin.components.views as Record<string, unknown>).spellcheck = {
        Component: `${pkgName}/views#SpellCheckView`,
        path: '/spellcheck',
      }
    }

    // 5. onInit: warn about the public LanguageTool endpoint, then auto-fix
    //    schema (push:true missing columns).
    //
    // With no `languageToolUrl`, every save of a scanned document — drafts and
    // never-published edits included — POSTs up to 18 000 characters of the
    // document to https://api.languagetool.org, a third party the host has not
    // contracted with and cannot list in its processing register. That is a
    // deliberate default (the plugin works out of the box), but it must not be
    // a silent one. Setting `languageToolUrl` (self-hosted instance) removes
    // the transfer; `acknowledgePublicApi: true` mutes the warning.
    const warnAboutPublicApi =
      !pluginConfig.languageToolUrl && pluginConfig.acknowledgePublicApi !== true
    const runAutoFixSchema = pluginConfig.autoFixSchema !== false

    if (warnAboutPublicApi || runAutoFixSchema) {
      const existingOnInit = config.onInit
      config.onInit = async (payload) => {
        if (existingOnInit) await existingOnInit(payload)
        if (warnAboutPublicApi) {
          payload.logger.warn(
            '[spellcheck] No `languageToolUrl` configured: document content (drafts included) ' +
              'is sent to the public API at https://api.languagetool.org/v2/check on every ' +
              'save of a scanned collection and during bulk scans. Point `languageToolUrl` at ' +
              'a self-hosted LanguageTool to keep the content in-house, or set ' +
              '`acknowledgePublicApi: true` to silence this warning.',
          )
        }
        if (runAutoFixSchema) await autoFixSchema(payload)
      }
    }

    return config
  }
