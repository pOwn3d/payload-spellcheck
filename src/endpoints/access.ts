/**
 * Single source of truth for "who may use the spellcheck plugin".
 *
 * The same check used to be copy-pasted in nine handlers while the two plugin
 * collections settled for `!!req.user`. That gap was an escalation path: any
 * authenticated account — including a front-office user with no admin access —
 * could read `/api/spellcheck-results` (titles, slugs and excerpts of unpublished
 * drafts), write arbitrary `issues` into it, and wait for an admin to click
 * "fix everything" to have that text applied to a published page with
 * `overrideAccess: true`.
 *
 * `!!req.user` was only half of the fix. A host with a second auth collection
 * (customers, members, partners — the norm on a multi-tenant or e-commerce
 * site) hands those accounts a `payload-token` too, and such an account
 * carrying `role: 'admin'` inside ITS OWN collection satisfied the default
 * check. The authoritative discriminator is the collection the user
 * authenticated against — `req.user.collection` — compared with the collection
 * that backs the admin panel, `config.admin.user`.
 */

import type { SpellCheckPluginConfig } from '../types.js'

/** What the default access function expects a user to look like. */
type AccessSubject = { user?: Record<string, unknown> | null }

/**
 * Minimal request shape the guard needs: the authenticated user, plus the
 * sanitized config so we can resolve the admin auth collection.
 */
export type AccessGuardRequest = {
  user?: unknown
  payload?: { config?: { admin?: { user?: string } } }
}

const ROLE_HINT =
  'Spellcheck is admin-only by default: the authenticated user must have `role: "admin"`, ' +
  'or a `roles` array containing "admin". If your Users collection models permissions ' +
  'differently, pass a custom `access: (req) => boolean` to spellcheckPlugin().'

/** Default access check: admin only. */
export function defaultSpellcheckAccess(r: AccessSubject): boolean {
  const u = r.user as Record<string, unknown> | null | undefined
  return Boolean(
    u?.role === 'admin' || (Array.isArray(u?.roles) && (u!.roles as string[]).includes('admin')),
  )
}

/**
 * True when the authenticated user comes from the collection that backs the
 * admin panel (`config.admin.user`).
 *
 * Deliberately permissive in the two cases where the answer cannot be known:
 *  - the sanitized config is not reachable (unit tests, hand-rolled request
 *    objects) — there is nothing to compare against;
 *  - `req.user` carries no `collection` (a user object built in host code and
 *    passed to the Local API) — HTTP authentication always sets it, so this
 *    branch is not reachable by a remote caller.
 * Everything that reaches the guard through the REST/GraphQL API does carry
 * `collection`, which is what the escalation path relied on.
 */
export function isAdminCollectionUser(req: AccessGuardRequest): boolean {
  const adminSlug = req.payload?.config?.admin?.user
  if (typeof adminSlug !== 'string' || !adminSlug) return true

  const userCollection = (req.user as { collection?: unknown } | null | undefined)?.collection
  if (typeof userCollection !== 'string') return true

  return userCollection === adminSlug
}

export interface AccessGuard {
  /**
   * True when the request may use the plugin. Always requires an authenticated
   * user coming from the admin auth collection, on top of the `access` check.
   */
  isAllowed(req: AccessGuardRequest): boolean
  /** 403 response, carrying a setup hint when the default (role-based) check is in use. */
  forbidden(): Response
}

export function createAccessGuard(pluginConfig?: SpellCheckPluginConfig): AccessGuard {
  const custom = pluginConfig?.access
  const accessFn = custom ?? defaultSpellcheckAccess

  return {
    isAllowed(req) {
      if (!req.user) return false
      // Runs BEFORE the (possibly custom) access function on purpose: a host
      // that passes `access: (req) => Boolean(req.user)` must not thereby open
      // the plugin to every front-office account.
      if (!isAdminCollectionUser(req)) return false
      return accessFn(req as AccessSubject)
    },
    forbidden() {
      return Response.json(
        { error: 'Unauthorized', ...(custom ? {} : { hint: ROLE_HINT }) },
        { status: 403 },
      )
    },
  }
}
