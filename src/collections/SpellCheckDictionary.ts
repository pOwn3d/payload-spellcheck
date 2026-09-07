/**
 * SpellCheckDictionary collection.
 * Stores custom dictionary words managed from the admin UI.
 * One document per word — simple, queryable, no JSON blob.
 */

import type { CollectionConfig } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { createAccessGuard } from '../endpoints/access.js'

export function createSpellCheckDictionaryCollection(
  pluginConfig?: SpellCheckPluginConfig,
): CollectionConfig {
  // Same gate as the endpoints — see SpellCheckResults for the rationale.
  // The dictionary silences spellcheck findings, so write access to it is a way
  // to hide mistakes from everyone; it belongs to the same trust level.
  const guard = createAccessGuard(pluginConfig)
  const allow = ({ req }: { req: { user?: unknown } }): boolean => guard.isAllowed(req)

  return {
    slug: 'spellcheck-dictionary',
    admin: {
      hidden: true,
    },
    access: {
      read: allow,
      create: allow,
      update: allow,
      delete: allow,
    },
    hooks: {
      beforeValidate: [
        ({ data }) => {
          if (data?.word && typeof data.word === 'string') {
            data.word = data.word.trim().toLowerCase()
          }
          return data
        },
      ],
    },
    fields: [
      {
        name: 'word',
        type: 'text',
        required: true,
        unique: true,
        index: true,
        maxLength: 100,
        admin: {
          description: 'Dictionary word (auto-lowercased, max 100 chars)',
        },
      },
      {
        name: 'addedBy',
        type: 'relationship',
        relationTo: 'users',
        admin: {
          description: 'User who added this word',
        },
      },
    ],
  }
}
