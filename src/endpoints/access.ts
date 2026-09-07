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
 */

import type { SpellCheckPluginConfig } from '../types.js'

/** What the default access function expects a user to look like. */
type AccessSubject = { user?: Record<string, unknown> | null }

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

export interface AccessGuard {
  /** True when the request may use the plugin. Always requires an authenticated user. */
  isAllowed(req: { user?: unknown }): boolean
  /** 403 response, carrying a setup hint when the default (role-based) check is in use. */
  forbidden(): Response
}

export function createAccessGuard(pluginConfig?: SpellCheckPluginConfig): AccessGuard {
  const custom = pluginConfig?.access
  const accessFn = custom ?? defaultSpellcheckAccess

  return {
    isAllowed(req) {
      if (!req.user) return false
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
