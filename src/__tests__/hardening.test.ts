/**
 * Regression tests for two hardening measures that have no natural home in the
 * endpoint tests:
 *  - the rate-limiter Map is bounded (it used to grow by one entry per distinct
 *    key, and the key was caller-supplied);
 *  - the plugin says out loud, at boot, that document content leaves for the
 *    public LanguageTool API when no `languageToolUrl` is configured.
 */

import { describe, it, expect } from 'vitest'
import type { Config, Payload } from 'payload'
import { createRateLimiter } from '../endpoints/rateLimit.js'
import { spellcheckPlugin } from '../plugin.js'

describe('rate limiter memory bound', () => {
  it('never keeps more keys than its ceiling', () => {
    // maxRequests high enough that nothing is ever refused: only the number of
    // tracked keys is under test.
    const limiter = createRateLimiter(1_000, 60_000, 10)

    for (let i = 0; i < 5_000; i++) {
      expect(limiter.check(`forged-ip-${i}`)).toBe(true)
    }

    expect(limiter.size).toBeLessThanOrEqual(10)
  })
})

describe('public LanguageTool API disclosure', () => {
  function fakePayload() {
    const warnings: string[] = []
    const payload = {
      logger: {
        info: () => {},
        warn: (msg: string) => warnings.push(msg),
        error: () => {},
      },
      find: async () => ({ docs: [] }),
    } as unknown as Payload
    return { payload, warnings }
  }

  async function boot(options: Record<string, unknown>): Promise<string[]> {
    const config = spellcheckPlugin(options)({} as Config)
    const { payload, warnings } = fakePayload()
    await config.onInit!(payload)
    return warnings
  }

  it('warns when document content would go to api.languagetool.org', async () => {
    const warnings = await boot({ collections: ['pages'] })
    expect(warnings.join('\n')).toContain('api.languagetool.org')
  })

  it('says nothing when a self-hosted instance is configured', async () => {
    const warnings = await boot({
      collections: ['pages'],
      languageToolUrl: 'http://languagetool.internal:8010/v2/check',
    })
    expect(warnings.join('\n')).not.toContain('api.languagetool.org')
  })

  it('can be acknowledged explicitly', async () => {
    const warnings = await boot({ collections: ['pages'], acknowledgePublicApi: true })
    expect(warnings.join('\n')).not.toContain('api.languagetool.org')
  })

  it('still runs an onInit already present on the host config', async () => {
    let hostRan = false
    const incoming = { onInit: async () => { hostRan = true } } as unknown as Config
    const config = spellcheckPlugin({ collections: ['pages'] })(incoming)
    const { payload } = fakePayload()
    await config.onInit!(payload)
    expect(hostRan).toBe(true)
  })
})
