/**
 * Regression tests for the bulk scan.
 *
 * The scan used to start with `payload.find({ limit: 0 })` per collection —
 * "no limit" in Payload — and hold every document, full Lexical trees included,
 * in a Map for the whole run (3 s per document: ~50 minutes on 1 000 pages).
 * These tests pin the pagination and the `maxDocs` ceiling.
 *
 * `currentJob` is module-level state, so this file keeps its own module
 * registry (vitest isolates per file) and its tests run in order.
 */

import { describe, it, expect } from 'vitest'
import type { Config } from 'payload'
import { spellcheckPlugin } from '../plugin.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyReq = any

interface FindCall {
  collection: string
  limit?: number
  page?: number
}

/**
 * Documents with no extractable text: the scan counts them, then `continue`s
 * before any LanguageTool call or rate-limit sleep. Nothing touches the network
 * and the scan finishes in a tick.
 */
function emptyDocs(count: number, from: number) {
  return Array.from({ length: count }, (_, i) => ({ id: from + i }))
}

function harness(
  totalDocs: number,
  pluginOptions: Record<string, unknown> = {},
  /**
   * How the fake `find` answers:
   *  - 'minimal' drops the optional fields (`hasNextPage`, `totalDocs`), the way
   *    a thin adapter or a wrapper around `payload.find` may;
   *  - 'stuck' always claims another page is coming.
   */
  findQuirk?: 'minimal' | 'stuck',
) {
  const calls: FindCall[] = []
  const config = spellcheckPlugin({
    collections: ['pages'],
    timeouts: { bulkRateLimitDelay: 0 },
    // The scan is polled below; without a budget of its own the poll loop hits
    // the 60/min default and reads a 429 body instead of the scan status —
    // a failure that would look like a broken scan.
    rateLimits: { status: 10_000 },
    ...pluginOptions,
  })({} as Config)

  const payload = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    config: { admin: { user: 'users' } },
    collections: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    find: async ({ collection, limit, page }: any) => {
      calls.push({ collection, limit, page })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const answer = (docs: any[], hasNextPage: boolean) => {
        if (findQuirk === 'minimal') return { docs }
        if (findQuirk === 'stuck') return { docs, totalDocs, hasNextPage: true }
        return { docs, totalDocs, hasNextPage }
      }
      if (collection !== 'pages') return answer([], false)
      if (limit === 1) return answer(emptyDocs(1, 1), totalDocs > 1)
      // Safety valve: if the walk ever stops terminating, fail the test loudly
      // instead of spinning for ever (the scan runs in the background).
      if ((page ?? 1) > 10) throw new Error('paging ran away')
      const start = ((page ?? 1) - 1) * limit
      const docs = emptyDocs(Math.max(0, Math.min(limit, totalDocs - start)), start + 1)
      return answer(docs, start + docs.length < totalDocs)
    },
    create: async () => ({ id: 1 }),
    update: async () => ({ id: 1 }),
  }

  const req = (overrides: Record<string, unknown> = {}): AnyReq => ({
    headers: new Headers(),
    user: { id: 1, collection: 'users', role: 'admin' },
    payload,
    json: async () => ({}),
    ...overrides,
  })

  function handler(path: string, method: string) {
    const endpoint = (config.endpoints || []).find((e) => e.path === path && e.method === method)!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return endpoint.handler as (r: AnyReq) => Promise<Response>
  }

  return { calls, req, handler }
}

/** Poll /status until the scan leaves the 'running' state. */
async function waitForScan(
  status: (r: AnyReq) => Promise<Response>,
  req: () => AnyReq,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    const res = await status(req())
    // Without its own budget the poll loop exhausts the /status limiter and
    // reads `{ error: 'Too many requests' }` — whose `status` is undefined, so
    // the loop would return it as a finished scan and the assertion would fail
    // on something unrelated. Say what actually happened.
    if (res.status === 429) throw new Error('the /status poll loop hit the rate limiter')
    const body = await res.json()
    if (body.status !== 'running') return body
  }
  throw new Error('scan never completed')
}

describe('bulk scan pagination', () => {
  it('never asks Payload for an unbounded result set', async () => {
    const { calls, req, handler } = harness(450)

    await handler('/spellcheck/bulk', 'post')(req())
    const done = await waitForScan(handler('/spellcheck/status', 'get'), req)

    expect(done.status).toBe('completed')
    // `limit: 0` means "every document, in one array" — the whole point.
    expect(calls.some((c) => c.limit === 0)).toBe(false)
    // One counting query, then fixed-size pages.
    expect(calls.filter((c) => c.limit === 1)).toHaveLength(1)
    const pages = calls.filter((c) => c.limit === 200)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.map((c) => c.page)).toEqual([1, 2, 3])
    expect(done.totalDocuments).toBe(450)
  })

  it('stops at maxDocs instead of walking the whole corpus', async () => {
    const { calls, req, handler } = harness(1000, { maxDocs: 150 })

    await handler('/spellcheck/bulk', 'post')(req())
    const done = await waitForScan(handler('/spellcheck/status', 'get'), req)

    expect(done.status).toBe('completed')
    expect(done.total).toBe(150)
    expect(done.totalDocuments).toBe(150)
    // A single page was enough; the remaining 800 documents were never fetched.
    expect(calls.filter((c) => c.limit === 200)).toHaveLength(1)
  })

  it('still scans the whole corpus when the answer carries no hasNextPage', async () => {
    // Paging replaced `limit: 0`, which needed nothing from the adapter but the
    // documents. Ending the loop on `hasNextPage` alone made the scan depend on
    // an optional field: a `find` that omits it stopped after the first page —
    // 200 of 450 documents checked, status 'completed', nothing in the logs.
    const { calls, req, handler } = harness(450, {}, 'minimal')

    await handler('/spellcheck/bulk', 'post')(req())
    const done = await waitForScan(handler('/spellcheck/status', 'get'), req)

    expect(done.status).toBe('completed')
    expect(done.totalDocuments).toBe(450)
    // Pages 1 and 2 are full, page 3 holds the last 50 and ends the walk.
    expect(calls.filter((c) => c.limit === 200).map((c) => c.page)).toEqual([1, 2, 3])
    // A missing `totalDocs` must not poison the progress counter either.
    expect(Number.isNaN(done.total as number)).toBe(false)
  })

  it('stops on an empty page instead of looping on a stuck hasNextPage', async () => {
    // The mirror failure of the one above: a flag that never turns false would
    // keep the loop querying for ever, holding the scan 'running' until the
    // stale timeout. The page contents settle it — 450 documents, then an empty
    // page ends the walk.
    const { calls, req, handler } = harness(450, {}, 'stuck')

    await handler('/spellcheck/bulk', 'post')(req())
    const done = await waitForScan(handler('/spellcheck/status', 'get'), req)

    expect(done.status).toBe('completed')
    expect(done.totalDocuments).toBe(450)
    // Three full-ish pages plus the empty one that stops the loop.
    expect(calls.filter((c) => c.limit === 200).map((c) => c.page)).toEqual([1, 2, 3, 4])
  })
})
