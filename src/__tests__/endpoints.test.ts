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

/**
 * A request carrying the sanitized config, so the guard can resolve which
 * collection backs the admin panel. `collection` is what Payload puts on
 * `req.user` after any HTTP login.
 */
function reqAs(user: Record<string, unknown> | null, overrides: Record<string, unknown> = {}): AnyReq {
  return fakeReq({
    user,
    payload: {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      config: { admin: { user: 'users' } },
    },
    ...overrides,
  })
}

describe('auth collection gate', () => {
  // A host with a front-office auth collection (customers, members, partners)
  // hands those accounts a payload-token too. One of them carrying role:'admin'
  // inside ITS OWN collection used to satisfy the default check and get the
  // drafts of every scanned collection, plus /fix on published documents.
  const frontOfficeAdmin = { id: 9, collection: 'customers', role: 'admin' }
  const realAdmin = { id: 1, collection: 'users', role: 'admin' }

  it('refuses an "admin" authenticated on another collection', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const collections = findHandler(config, '/spellcheck/collections', 'get')

    expect((await collections(reqAs(frontOfficeAdmin))).status).toBe(403)
    expect((await collections(reqAs(realAdmin))).status).toBe(200)
  })

  it('holds even when the integrator passed `access: (req) => Boolean(req.user)`', async () => {
    const config = buildConfig({
      collections: ['pages'],
      access: (req) => Boolean(req.user),
    })
    const collections = findHandler(config, '/spellcheck/collections', 'get')

    // The README used to recommend exactly this snippet.
    expect((await collections(reqAs({ id: 9, collection: 'newsletter' }))).status).toBe(403)
    expect((await collections(reqAs({ id: 1, collection: 'users' }))).status).toBe(200)
  })

  it('closes the same door on the plugin collections, not just the endpoints', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const payload = { config: { admin: { user: 'users' } } }

    for (const slug of ['spellcheck-results', 'spellcheck-dictionary']) {
      const collection = (config.collections || []).find((c) => c.slug === slug)!
      const access = collection.access!
      for (const op of ['read', 'create', 'update', 'delete'] as const) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await access[op]!({ req: { user: frontOfficeAdmin, payload } } as any)).toBe(false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await access[op]!({ req: { user: realAdmin, payload } } as any)).toBe(true)
      }
    }
  })

  it('gates the dashboard view the same way', async () => {
    const config = buildConfig({ collections: ['pages'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isAllowed = (config.custom as any)?.spellcheck?.isAllowed
    const payload = { config: { admin: { user: 'users' } } }
    expect(isAllowed({ user: frontOfficeAdmin, payload })).toBe(false)
    expect(isAllowed({ user: realAdmin, payload })).toBe(true)
  })
})

describe('rate limiter ordering', () => {
  it('does not let anonymous callers touch the limiter at all', async () => {
    const config = buildConfig({ collections: ['pages'], rateLimits: { status: 2 } })
    const status = findHandler(config, '/spellcheck/status', 'get')

    // Anonymous flood, all forging the admin's egress IP. Each of these used to
    // create a Map entry and eat the bucket the admin shares.
    for (let i = 0; i < 20; i++) {
      const res = await status(reqAs(null, { headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }) }))
      expect(res.status).toBe(403)
    }

    // The admin's budget is untouched.
    const admin = { id: 1, collection: 'users', role: 'admin' }
    expect((await status(reqAs(admin))).status).toBe(200)
    expect((await status(reqAs(admin))).status).toBe(200)
  })

  it('keys the budget on the account, not on the caller-supplied IP', async () => {
    const config = buildConfig({ collections: ['pages'], rateLimits: { status: 2 } })
    const status = findHandler(config, '/spellcheck/status', 'get')
    const admin = { id: 1, collection: 'users', role: 'admin' }

    const withIp = (ip: string) => reqAs(admin, { headers: new Headers({ 'x-forwarded-for': ip }) })

    expect((await status(withIp('198.51.100.1'))).status).toBe(200)
    expect((await status(withIp('198.51.100.2'))).status).toBe(200)
    // Rotating X-Forwarded-For used to hand out a fresh bucket every time.
    expect((await status(withIp('198.51.100.3'))).status).toBe(429)
  })
})

describe('/fix-all issue selection', () => {
  function payloadWithIssues(issues: unknown[]) {
    return {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      config: { admin: { user: 'users' } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      find: async ({ collection }: any) =>
        collection === 'spellcheck-results'
          ? { docs: [{ id: 1, issues }] }
          : { docs: [] },
    }
  }

  const claudeIssue = {
    ruleId: 'CLAUDE_PHRASING',
    category: 'PHRASING',
    message: 'injected',
    context: '',
    contextOffset: 0,
    offset: 0,
    length: 7,
    original: 'Bonjour',
    replacements: ['Acheté sur evil.example'],
    source: 'claude',
  }
  const languageToolIssue = { ...claudeIssue, ruleId: 'FR_SPELL', source: 'languagetool' }

  it('never replays a Claude suggestion unattended', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const fixAll = findHandler(config, '/spellcheck/fix-all', 'post')

    const res = await fixAll(
      reqAs({ id: 1, collection: 'users', role: 'admin' }, {
        json: async () => ({ id: '1', collection: 'pages' }),
        payload: payloadWithIssues([claudeIssue]),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ applied: 0, failed: 0, details: [] })
  })

  it('still processes LanguageTool issues sitting next to a Claude one', async () => {
    const config = buildConfig({ collections: ['pages'] })
    const fixAll = findHandler(config, '/spellcheck/fix-all', 'post')

    const res = await fixAll(
      reqAs({ id: 1, collection: 'users', role: 'admin' }, {
        json: async () => ({ id: '1', collection: 'pages' }),
        payload: payloadWithIssues([claudeIssue, languageToolIssue]),
      }),
    )

    const body = await res.json()
    // Exactly one attempt: the LanguageTool one (it fails here because the fake
    // payload returns no document — what matters is that it was the only one).
    expect(body.details).toHaveLength(1)
    expect(body.applied + body.failed).toBe(1)
  })
})

/**
 * The dashboard persists "ignore this issue" with a plain REST PATCH on
 * `spellcheck-results` rather than through a plugin endpoint. That is only
 * defensible while the collection's own `access` is the SAME gate the endpoints
 * enforce — otherwise the PATCH becomes a way around them.
 *
 * These tests pin that equivalence. If someone ever loosens the collection
 * (back to `!!req.user`, say, or by dropping the admin-collection check), they
 * fail here, and the "no dedicated endpoint needed" decision recorded in
 * `SpellCheckResults.ts` has to be re-opened rather than silently invalidated.
 */
describe('collection access matches endpoint access', () => {
  function collectionAccess(config: Config, slug: string) {
    const collection = (config.collections || []).find((c) => c.slug === slug)
    if (!collection) throw new Error(`collection ${slug} not registered`)
    return collection.access as Record<
      'read' | 'create' | 'update' | 'delete',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => boolean
    >
  }

  const scenarios: Array<[string, Record<string, unknown>, boolean]> = [
    ['an admin of the admin collection', { user: { id: 1, collection: 'users', role: 'admin' } }, true],
    ['an editor of the admin collection', { user: { id: 2, collection: 'users', role: 'editor' } }, false],
    // The escalation the 0.16.0 guard closed: `role: 'admin'` inside a SECOND
    // auth collection. It must be refused by the collection exactly as the
    // endpoint refuses it.
    ['an "admin" of a front-office collection', { user: { id: 3, collection: 'customers', role: 'admin' } }, false],
    ['an anonymous caller', { user: null }, false],
  ]

  for (const slug of ['spellcheck-results', 'spellcheck-dictionary']) {
    for (const [label, overrides, expected] of scenarios) {
      it(`${slug}: ${label} is treated the same as by /validate`, async () => {
        const config = buildConfig({ collections: ['pages'] })
        const payload = { config: { admin: { user: 'users' } } }
        const req = fakeReq({ ...overrides, payload })

        const access = collectionAccess(config, slug)
        for (const operation of ['read', 'create', 'update', 'delete'] as const) {
          expect(access[operation]!({ req }), `${slug}.${operation}`).toBe(expected)
        }

        const validate = findHandler(config, '/spellcheck/validate', 'post')
        const res = await validate(req)
        expect(res.status === 403).toBe(!expected)
      })
    }
  }
})
