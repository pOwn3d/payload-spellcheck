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

/**
 * `autoFixSchema` runs raw DDL — `ALTER TABLE payload_locked_documents_rels` —
 * on a table of Payload's own core, outside the `payload-migrations` ledger,
 * and it is on by default. These tests pin what it actually does on each shape
 * of database client, because the README used to promise more than the code
 * delivers.
 *
 * The finding that matters: `@payloadcms/db-sqlite` (3.79+, the supported peer
 * floor) builds its client with `createClient` from `@libsql/client`, whose API
 * is `execute()` / `executeMultiple()` — there is no `exec()`. So on every
 * supported SQLite setup the automatic path is unreachable and the plugin only
 * LOGS the statement. Whether that ever changes is a decision to take
 * deliberately, not a line to slip into a patch release: these tests fail if it
 * changes by accident.
 */
describe('autoFixSchema', () => {
  type Probe = {
    warnings: string[]
    executed: string[]
    findCalls: number
  }

  function bootWithBrokenSchema(
    options: Record<string, unknown>,
    db: unknown,
  ): { probe: Probe; config: Config; run: () => Promise<void> } {
    const probe: Probe = { warnings: [], executed: [], findCalls: 0 }
    const payload = {
      logger: {
        info: () => {},
        warn: (msg: string) => probe.warnings.push(msg),
        error: () => {},
      },
      find: async () => {
        probe.findCalls++
        throw new Error(
          'SqliteError: no such column: payload_locked_documents_rels.spellcheck_dictionary_id',
        )
      },
      db,
    } as unknown as Payload

    // `acknowledgePublicApi` so the LanguageTool disclosure does not pollute
    // the warning list these tests read.
    const config = spellcheckPlugin({
      collections: ['pages'],
      acknowledgePublicApi: true,
      ...options,
    })({} as Config)
    return { probe, config, run: () => config.onInit!(payload) as Promise<void> }
  }

  it('only logs the statement on a libsql client, which has no exec()', async () => {
    // Exactly the shape @payloadcms/db-sqlite exposes: execute/executeMultiple.
    const { probe, run } = bootWithBrokenSchema(
      {},
      { client: { execute: async () => ({ rows: [] }), executeMultiple: async () => {} } },
    )
    await run()

    expect(probe.findCalls).toBe(1)
    expect(probe.executed).toEqual([])
    const warned = probe.warnings.join('\n')
    expect(warned).toContain('ALTER TABLE payload_locked_documents_rels')
    expect(warned).toContain('spellcheck_dictionary_id')
  })

  it('executes the statement only when the client exposes exec()', async () => {
    const executed: string[] = []
    const { probe, run } = bootWithBrokenSchema(
      {},
      { client: { exec: (sql: string) => executed.push(sql) } },
    )
    await run()

    expect(executed).toEqual([
      'ALTER TABLE payload_locked_documents_rels ADD COLUMN spellcheck_dictionary_id integer',
    ])
    expect(probe.warnings.join('\n')).not.toContain('could not access raw DB client')
  })

  it('swallows a duplicate-column error instead of warning on every boot', async () => {
    const { probe, run } = bootWithBrokenSchema(
      {},
      {
        client: {
          exec: () => {
            throw new Error('duplicate column name: spellcheck_dictionary_id')
          },
        },
      },
    )
    await run()
    expect(probe.warnings).toEqual([])
  })

  it('touches nothing at all when opted out', async () => {
    const { config } = bootWithBrokenSchema({ autoFixSchema: false }, { client: {} })
    // Nothing left for onInit to do: the plugin does not even install a hook,
    // so a host that opted out keeps the exact boot sequence it had before.
    expect(config.onInit).toBeUndefined()
  })

  it('opting out still leaves the LanguageTool disclosure in place', async () => {
    const { probe, run } = bootWithBrokenSchema(
      { autoFixSchema: false, acknowledgePublicApi: false },
      { client: { exec: () => { throw new Error('should not run') } } },
    )
    await run()
    // The probe query is the first thing autoFixSchema does: not running it is
    // the proof the whole mechanism was skipped.
    expect(probe.findCalls).toBe(0)
    expect(probe.warnings.join('\n')).toContain('api.languagetool.org')
    expect(probe.warnings.join('\n')).not.toContain('ALTER TABLE')
  })

  it('never runs the DDL on an unrelated failure', async () => {
    const executed: string[] = []
    const probe: Probe = { warnings: [], executed, findCalls: 0 }
    const payload = {
      logger: { info: () => {}, warn: (m: string) => probe.warnings.push(m), error: () => {} },
      find: async () => {
        probe.findCalls++
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432')
      },
      db: { client: { exec: (sql: string) => executed.push(sql) } },
    } as unknown as Payload

    const config = spellcheckPlugin({
      collections: ['pages'],
      acknowledgePublicApi: true,
    })({} as Config)
    await config.onInit!(payload)

    expect(executed).toEqual([])
    expect(probe.findCalls).toBe(1)
  })
})
