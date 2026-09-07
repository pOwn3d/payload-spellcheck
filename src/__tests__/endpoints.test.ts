/**
 * Regression tests on the endpoints registered by the plugin:
 *  - /status must not share the /bulk rate-limit budget (self-inflicted 429s)
 *  - /bulk must refuse collections outside the configured allowlist
 *  - a 403 must tell the integrator which role is expected
 */

import { describe, it, expect } from 'vitest'
import type { Config } from 'payload'
import { spellcheckPlugin } from '../plugin.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyReq = any

function buildConfig(pluginOptions = {}): Config {
  return spellcheckPlugin(pluginOptions)({} as Config)
}

function findHandler(config: Config, path: string, method: string) {
  const endpoint = (config.endpoints || []).find(
    (e) => e.path === path && e.method === method,
  )
  if (!endpoint) throw new Error(`endpoint ${method.toUpperCase()} ${path} not registered`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return endpoint.handler as (req: AnyReq) => Promise<Response> | Response
}

function fakeReq(overrides: Record<string, unknown> = {}): AnyReq {
  return {
    headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }),
    user: { id: 1, role: 'admin' },
    payload: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
    json: async () => ({}),
    ...overrides,
  }
}

describe('/status rate limiting', () => {
  it('does not burn the /bulk budget (3 req/min) when polled', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const status = findHandler(config, '/spellcheck/status', 'get')

    // The dashboard polls every 2 s; under the shared bulk limiter the 4th call
    // already answered 429 and the UI never saw the scan finish.
    for (let i = 0; i < 10; i++) {
      const res = await status(fakeReq())
      expect(res.status).not.toBe(429)
    }
  })
})

describe('/bulk collection allowlist', () => {
  it('refuses a collection outside the configured list', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const bulk = findHandler(config, '/spellcheck/bulk', 'post')

    const res = await bulk(fakeReq({ json: async () => ({ collection: 'users' }) }))
    expect(res.status).toBe(403)
  })

  it('refuses a forbidden collection hidden in ids[]', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const bulk = findHandler(config, '/spellcheck/bulk', 'post')

    const res = await bulk(
      fakeReq({
        json: async () => ({
          ids: [
            { id: '1', collection: 'pages' },
            { id: '2', collection: 'users' },
          ],
        }),
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe('403 responses', () => {
  it('explains the expected role when the default access check is in use', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const collections = findHandler(config, '/spellcheck/collections', 'get')

    const res = await collections(fakeReq({ user: { id: 2, role: 'editor' } }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.hint).toMatch(/admin/)
  })

  it('stays silent about roles when the integrator supplied its own check', async () => {
    const config = buildConfig({ collections: ['pages'], access: () => false })
    const collections = findHandler(config, '/spellcheck/collections', 'get')

    const res = await collections(fakeReq())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.hint).toBeUndefined()
  })

  it('refuses anonymous callers even with a permissive custom access fn', async () => {
    const config = buildConfig({ collections: ['pages'], access: () => true })
    const collections = findHandler(config, '/spellcheck/collections', 'get')

    const res = await collections(fakeReq({ user: null }))
    expect(res.status).toBe(403)
  })
})

describe('dashboard view gate', () => {
  it('publishes the access check on config.custom for the server-rendered view', async () => {
    const config = buildConfig({ collections: ['pages'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isAllowed = (config.custom as any)?.spellcheck?.isAllowed
    expect(typeof isAllowed).toBe('function')
    expect(isAllowed({ user: { id: 1, role: 'admin' } })).toBe(true)
    expect(isAllowed({ user: { id: 2, role: 'editor' } })).toBe(false)
    expect(isAllowed({ user: null })).toBe(false)
  })

  it('preserves anything another plugin already put on config.custom', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incoming = { custom: { somethingElse: 42 } } as any
    const config = spellcheckPlugin({ collections: ['pages'] })(incoming)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((config.custom as any).somethingElse).toBe(42)
  })
})

describe('plugin collections access', () => {
  function accessOf(config: Config, slug: string) {
    const collection = (config.collections || []).find((c) => c.slug === slug)
    if (!collection) throw new Error(`collection ${slug} not registered`)
    return collection.access!
  }

  it('reserves spellcheck-results for admins, not every authenticated user', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const access = accessOf(config, 'spellcheck-results')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asEditor = { req: { user: { id: 2, role: 'editor' } } } as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asAdmin = { req: { user: { id: 1, role: 'admin' } } } as any

    for (const op of ['read', 'create', 'update', 'delete'] as const) {
      expect(await access[op]!(asEditor)).toBe(false)
      expect(await access[op]!(asAdmin)).toBe(true)
    }
  })

  it('follows a custom access function on the dictionary collection', async () => {
    const config = buildConfig({
      collections: ['pages'],
      access: (req) => Boolean(req.user),
    })
    const access = accessOf(config, 'spellcheck-dictionary')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await access.read!({ req: { user: { id: 2, role: 'editor' } } } as any)).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await access.read!({ req: { user: null } } as any)).toBe(false)
  })
})
