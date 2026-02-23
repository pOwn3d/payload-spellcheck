/**
 * SpellCheckDictionary collection.
 * Stores custom dictionary words managed from the admin UI.
 * One document per word — simple, queryable, no JSON blob.
 */

import type { CollectionConfig } from 'payload'

export function createSpellCheckDictionaryCollection(): CollectionConfig {
  return {
    slug: 'spellcheck-dictionary',
    admin: {
      hidden: true,
    },
    access: {
      read: ({ req }) => !!req.user,
      create: ({ req }) => !!req.user,
      update: ({ req }) => !!req.user,
      delete: ({ req }) => !!req.user,
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
        admin: {
          description: 'Dictionary word (auto-lowercased)',
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
