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
      // `ignoredIssues` is written by the admin UI with a plain REST PATCH on
      // this collection (SpellCheckDashboard.handleIgnore, SpellCheckField), not
      // through a plugin endpoint. That was reviewed and deliberately left as
      // is: since 0.15.0 `access.update` here is the SAME `guard.isAllowed`
      // the endpoints run, and since 0.16.0 that guard also requires the caller
      // to have authenticated against `config.admin.user`. So the set of
      // accounts able to PATCH this row is exactly the set able to call a
      // dedicated endpoint — routing the write through one would move code
      // without narrowing anything.
      //
      // What a dedicated endpoint WOULD add is field-level narrowing: a PATCH
      // can also rewrite `issues`, which `/fix-all` later applies to published
      // documents with `overrideAccess: true`. But `/fix-all` is open to that
      // same set of accounts anyway, so the actor set is unchanged — it is a
      // defence-in-depth refactor, not a fix. Re-open it only if the guard on
      // this collection is ever loosened relative to the endpoints'.
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
