/**
 * SpellCheckResults collection.
 * Stores spellcheck results per document for dashboard display and history.
 */

import type { CollectionConfig } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { createAccessGuard, type AccessGuardRequest } from '../endpoints/access.js'

export function createSpellCheckResultsCollection(
  pluginConfig?: SpellCheckPluginConfig,
): CollectionConfig {
  // Same gate as the endpoints. `!!req.user` used to let ANY authenticated
  // account read draft titles/slugs/excerpts through the REST API — and, worse,
  // write `issues` that /fix-all later applies to published documents with
  // overrideAccess: true. The plugin writes to this collection internally with
  // overrideAccess: true, so tightening it does not affect scans or fixes.
  // The guard also checks that the user authenticated against the admin
  // collection (config.admin.user): an account of a front-office auth
  // collection carrying role:'admin' in ITS OWN collection used to pass.
  const guard = createAccessGuard(pluginConfig)
  const allow = ({ req }: { req: AccessGuardRequest }): boolean => guard.isAllowed(req)

  return {
    slug: 'spellcheck-results',
    admin: {
      hidden: true,
    },
    access: {
      read: allow,
      create: allow,
      update: allow,
      delete: allow,
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
        name: 'readability',
        type: 'json',
        admin: {
          description: 'Readability analysis result (score, grade, avgSentenceLength, etc.)',
        },
      },
      {
        name: 'consistency',
        type: 'json',
        admin: {
          description: 'JSON array of ConsistencyIssue objects (term variants)',
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
