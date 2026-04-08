/**
 * Hook to get spellcheck translations based on Payload's active locale.
 * Tries useTranslation from @payloadcms/ui first, falls back to browser locale.
 */

'use client'

import { useMemo } from 'react'
import { getTranslations, type SpellcheckTranslations, type SpellcheckLocale } from '../i18n.js'

// Try to detect locale from Payload's useTranslation hook
let usePayloadLocale: (() => string) | null = null

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ui = require('@payloadcms/ui')
  if (ui.useTranslation) {
    usePayloadLocale = () => {
      const { i18n } = ui.useTranslation()
      return i18n?.language || 'fr'
    }
  }
} catch {
  // @payloadcms/ui not available — use browser locale
}

/**
 * Detect the active locale from Payload or the browser.
 */
function detectLocale(): SpellcheckLocale {
  if (usePayloadLocale) {
    try {
      const lang = usePayloadLocale()
      if (lang.startsWith('en')) return 'en'
      return 'fr'
    } catch {
      // Hook called outside provider — fallback
    }
  }

  // Browser locale fallback
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language || ''
    if (lang.startsWith('en')) return 'en'
  }

  return 'fr'
}

/**
 * React hook returning spellcheck translations for the active locale.
 */
export function useSpellcheckI18n(): SpellcheckTranslations {
  const locale = detectLocale()
  return useMemo(() => getTranslations(locale), [locale])
}
