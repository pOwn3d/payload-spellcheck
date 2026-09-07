/**
 * Regression tests for the "a failed check is not a perfect score" invariant,
 * and for the afterChange anti-loop guards.
 *
 * `fetch` is stubbed throughout: these tests never touch the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Payload } from 'payload'
import { runLanguageToolCheck } from '../engine/languagetool.js'
import { recheckDocument } from '../utils/recheck.js'
import { createAfterChangeCheckHook } from '../hooks/afterChangeCheck.js'
import { invalidateDictionaryCache } from '../endpoints/dictionary.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any

function okResponse(matches: unknown[] = []): Response {
  return { ok: true, status: 200, json: async () => ({ matches }) } as unknown as Response
}

function failResponse(status: number): Response {
  return { ok: false, status, statusText: 'Too Many Requests', json: async () => ({}) } as unknown as Response
}

interface FakePayload {
  payload: Payload
  calls: { find: number; create: number; update: number }
}

function fakePayload(): FakePayload {
  const calls = { find: 0, create: 0, update: 0 }
  const payload = {
    find: async () => {
      calls.find++
      return { docs: [] }
    },
    create: async () => {
      calls.create++
      return { id: 1 }
    },
    update: async () => {
      calls.update++
      return { id: 1 }
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as Payload
  return { payload, calls }
}

const doc: AnyDoc = {
  id: 7,
  title: 'Bonjour',
  content: { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bonjour le monde entier' }] }] } },
}

beforeEach(() => {
  invalidateDictionaryCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runLanguageToolCheck', () => {
  it('reports a failure instead of an empty issue list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failResponse(429)))
    const outcome = await runLanguageToolCheck('Bonjour le monde', 'fr', {})
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('429')
  })

  it('reports success with an empty list when the text really is clean', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse([])))
    const outcome = await runLanguageToolCheck('Bonjour le monde', 'fr', {})
    expect(outcome).toEqual({ ok: true, issues: [] })
  })
})

describe('recheckDocument', () => {
  it('writes nothing when the engine is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failResponse(503)))
    const { payload, calls } = fakePayload()

    const outcome = await recheckDocument(payload, 'pages', doc, {})

    expect(outcome.ok).toBe(false)
    // No upsert: a stored result holding real mistakes must survive an outage.
    expect(calls.create).toBe(0)
    expect(calls.update).toBe(0)
  })

  it('stores the result when the check succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse([])))
    const { payload, calls } = fakePayload()

    const outcome = await recheckDocument(payload, 'pages', doc, {})

    expect(outcome.ok).toBe(true)
    expect(calls.create).toBe(1)
  })
})

describe('afterChange hook — anti-loop guards', () => {
  function runHook(extra: { context?: AnyDoc; query?: AnyDoc }) {
    const fetchMock = vi.fn(async () => okResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const { payload } = fakePayload()
    const hook = createAfterChangeCheckHook({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hook({
      doc,
      collection: { slug: 'pages' },
      req: { payload, query: extra.query ?? {}, context: extra.context ?? {} },
      context: extra.context ?? {},
    } as any)
    return fetchMock
  }

  it('runs a check on a normal save', async () => {
    const fetchMock = runHook({})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  it('skips the check when our own fix wrote the document', async () => {
    const fetchMock = runHook({ context: { skipSpellcheck: true } })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips the check on an autosave tick', async () => {
    const fetchMock = runHook({ query: { autosave: 'true' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
