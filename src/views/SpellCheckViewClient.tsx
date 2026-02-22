'use client'

// Import from our own package's client entry — tsup keeps this external,
// preserving the RSC boundary (this file = client, SpellCheckView wrapper = server)
// @ts-ignore — self-reference via package exports
export { SpellCheckDashboard as SpellCheckViewClient } from '@consilioweb/spellcheck/client'
