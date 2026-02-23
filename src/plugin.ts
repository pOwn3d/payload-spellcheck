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
 *   import { spellcheckPlugin } from '@consilioweb/spellcheck'
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
import { createBulkHandler, createStatusHandler } from './endpoints/bulk.js'
import { createDictionaryListHandler, createDictionaryAddHandler, createDictionaryDeleteHandler } from './endpoints/dictionary.js'
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
                  Field: '@consilioweb/spellcheck/client#SpellCheckField',
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
                  Cell: '@consilioweb/spellcheck/client#SpellCheckScoreCell',
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
      createSpellCheckResultsCollection(),
      createSpellCheckDictionaryCollection(),
    ]

    // 3. Add API endpoints
    config.endpoints = [
      ...(config.endpoints || []),
      {
        path: `${basePath}/validate`,
        method: 'post' as const,
        handler: createValidateHandler(pluginConfig),
      },
      {
        path: `${basePath}/fix`,
        method: 'post' as const,
        handler: createFixHandler(pluginConfig),
      },
      {
        path: `${basePath}/bulk`,
        method: 'post' as const,
        handler: createBulkHandler(targetCollections, pluginConfig),
      },
      {
        path: `${basePath}/status`,
        method: 'get' as const,
        handler: createStatusHandler(),
      },
      {
        path: `${basePath}/dictionary`,
        method: 'get' as const,
        handler: createDictionaryListHandler(),
      },
      {
        path: `${basePath}/dictionary`,
        method: 'post' as const,
        handler: createDictionaryAddHandler(),
      },
      {
        path: `${basePath}/dictionary`,
        method: 'delete' as const,
        handler: createDictionaryDeleteHandler(),
      },
      {
        path: `${basePath}/collections`,
        method: 'get' as const,
        handler: (async (req) => {
          if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
          return Response.json({ collections: targetCollections })
        }) as import('payload').PayloadHandler,
      },
    ]

    // 4. Add dashboard view
    if (addDashboardView) {
      if (!config.admin) config.admin = {}
      if (!config.admin.components) config.admin.components = {}
      if (!config.admin.components.views) config.admin.components.views = {}

      ;(config.admin.components.views as Record<string, unknown>).spellcheck = {
        Component: '@consilioweb/spellcheck/views#SpellCheckView',
        path: '/spellcheck',
      }
    }

    // 5. Add onInit hook to auto-fix schema (push:true missing columns)
    const existingOnInit = config.onInit
    config.onInit = async (payload) => {
      if (existingOnInit) await existingOnInit(payload)
      await autoFixSchema(payload)
    }

    return config
  }
