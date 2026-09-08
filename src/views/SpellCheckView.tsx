/**
 * SpellCheckView — Server component wrapper.
 * Wraps the client dashboard in Payload's DefaultTemplate.
 */

import type { AdminViewServerProps } from 'payload'
// @ts-ignore — @payloadcms/next is a peer dependency
import { DefaultTemplate } from '@payloadcms/next/templates'
import React from 'react'
// @ts-ignore — next is a peer dependency
import { redirect } from 'next/navigation'
import { SpellCheckViewClient } from './SpellCheckViewClient.js'
// Imported through the package's own client subpath, NOT via a relative path.
// tsup bundles this entry, and `@consilioweb/payload-spellcheck/client` is in
// its `external` list: going through the subpath is what keeps the boundary
// class on the client side of the RSC split. A relative import would inline the
// class — a stateful component with lifecycle methods — into the server bundle.
// @ts-ignore — self-reference via package exports
import { AdminErrorBoundary } from '@consilioweb/payload-spellcheck/client'

export const SpellCheckView: React.FC<AdminViewServerProps> = (props) => {
  const { initPageResult } = props

  if (!initPageResult?.req?.user) { redirect('/admin/login') }

  const { req, visibleEntities, permissions, locale } = initPageResult

  // Gate the view with the very check the endpoints use, published by the plugin
  // on config.custom. Without it any authenticated user could open the dashboard
  // and just see every request inside it fail with 403.
  // If the entry is missing (view registered without the plugin, older config),
  // fall back to the previous behaviour: authenticated is enough.
  const isAllowed = (req.payload?.config?.custom as
    | { spellcheck?: { isAllowed?: (r: { user?: unknown }) => boolean } }
    | undefined)?.spellcheck?.isAllowed
  if (isAllowed && !isAllowed(req)) { redirect('/admin') }

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={{}}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={{}}
      user={req.user!}
      visibleEntities={visibleEntities}
    >
      {/*
        Full-page view: here a VISIBLE fallback is the right call. The dashboard
        is the whole content of the screen, so degrading silently would leave the
        admin staring at an empty page with no way to tell a crash from an empty
        dictionary. The surrounding DefaultTemplate — nav, breadcrumbs, logout —
        keeps working.
      */}
      <AdminErrorBoundary viewName="SpellCheckView">
        <SpellCheckViewClient />
      </AdminErrorBoundary>
    </DefaultTemplate>
  )
}

export default SpellCheckView
