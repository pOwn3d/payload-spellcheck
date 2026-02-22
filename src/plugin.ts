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
import { createValidateHandler } from './endpoints/validate.js'
import { createFixHandler } from './endpoints/fix.js'
import { createBulkHandler } from './endpoints/bulk.js'
import { createAfterChangeCheckHook } from './hooks/afterChangeCheck.js'

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

        return updated
      })
    }

    // 2. Add SpellCheckResults collection
    config.collections = [
      ...(config.collections || []),
      createSpellCheckResultsCollection(),
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

    return config
  }
