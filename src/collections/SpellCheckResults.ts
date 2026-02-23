/**
 * SpellCheckResults collection.
 * Stores spellcheck results per document for dashboard display and history.
 */

import type { CollectionConfig } from 'payload'

export function createSpellCheckResultsCollection(): CollectionConfig {
  return {
    slug: 'spellcheck-results',
    admin: {
      hidden: true,
    },
    access: {
      read: ({ req }) => !!req.user,
      create: ({ req }) => !!req.user,
      update: ({ req }) => !!req.user,
      delete: ({ req }) => req.user?.role === 'admin',
    },
    timestamps: false,
    fields: [
      {
        name: 'docId',
        type: 'text',
        required: true,
        index: true,
        admin: {
          description: 'ID of the checked document',
        },
      },
      {
        name: 'collection',
        type: 'text',
        required: true,
        index: true,
        admin: {
          description: "Collection slug (e.g. 'pages', 'posts')",
        },
      },
      {
        name: 'title',
        type: 'text',
        admin: {
          description: 'Document title (for dashboard display)',
        },
      },
      {
        name: 'slug',
        type: 'text',
        admin: {
          description: 'Document slug',
        },
      },
      {
        name: 'score',
        type: 'number',
        required: true,
        min: 0,
        max: 100,
        admin: {
          description: 'Spellcheck score (0-100, 100 = no issues)',
        },
      },
      {
        name: 'issueCount',
        type: 'number',
        required: true,
        min: 0,
        admin: {
          description: 'Number of issues found',
        },
      },
      {
        name: 'wordCount',
        type: 'number',
        min: 0,
        admin: {
          description: 'Word count of the extracted text',
        },
      },
      {
        name: 'issues',
        type: 'json',
        admin: {
          description: 'JSON array of SpellCheckIssue objects',
        },
      },
      {
        name: 'ignoredIssues',
        type: 'json',
        admin: {
          description: 'JSON array of { ruleId, original } — issues ignored by the user, filtered on rescan',
        },
      },
      {
        name: 'lastChecked',
        type: 'date',
        required: true,
        index: true,
        defaultValue: () => new Date().toISOString(),
        admin: {
          description: 'Date of the last spellcheck',
        },
      },
    ],
  }
}
