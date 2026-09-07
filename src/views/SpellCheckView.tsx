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
      <SpellCheckViewClient />
    </DefaultTemplate>
  )
}

export default SpellCheckView
