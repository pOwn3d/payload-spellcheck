/**
 * Regression tests for applyFix().
 *
 * The offset alignment between the scan (which reads TRIMMED text) and the fix
 * (which mutates the RAW Lexical tree) has broken four times — 0.9.4, 0.9.7,
 * 0.9.8 and 0.10.0 — because nothing locked the invariant down. These tests
 * pin it, using a fake payload with just find() and update(): no DB, no infra.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Payload } from 'payload'
import type { SpellCheckIssue } from '../types.js'
import { applyFix } from '../endpoints/fixCore.js'
import { createFixAllHandler } from '../endpoints/fixAll.js'
import { createFixHandler } from '../endpoints/fix.js'
import { realignIssues } from '../utils/realignIssues.js'
import { extractAllTextFromDoc } from '../engine/lexicalParser.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any

/** Fake Payload exposing only what applyFix() touches. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakePayload(doc: AnyDoc): { payload: Payload; updates: any[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any[] = []
  const payload = {
    find: async () => ({ docs: [doc] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: async (args: any) => {
      updates.push(args)
      return doc
    },
  } as unknown as Payload
  return { payload, updates }
}

/** paragraph node with a single text child */
function para(text: string): AnyDoc {
  return { type: 'paragraph', children: [{ type: 'text', text }] }
}

function lexical(children: AnyDoc[]): AnyDoc {
  return { root: { type: 'root', children } }
}

describe('applyFix — offset alignment', () => {
  it('lands on the right word when a leading empty block shifts the raw tree', async () => {
    // Raw extraction is "\nBonjour le mondee\n"; the scan sees the TRIMMED
    // "Bonjour le mondee". Before leadingTrim, the fix was applied one char too
    // early and produced "Bonjour lemondee".
    const doc: AnyDoc = {
      id: 1,
      content: lexical([{ type: 'paragraph', children: [] }, para('Bonjour le mondee')]),
    }
    const fullText = extractAllTextFromDoc(doc, 'content')
    expect(fullText).toBe('Bonjour le mondee')

    const { payload, updates } = fakePayload(doc)
    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'mondee', replacement: 'monde', offset: 11, length: 6 },
      {},
    )

    expect(res.success).toBe(true)
    expect(res.method).toBe('offset')
    expect(doc.content.root.children[1].children[0].text).toBe('Bonjour le monde')
    expect(updates).toHaveLength(1)
  })

  it('refuses a span that reaches past its text node instead of duplicating text', async () => {
    // "Bon" + "jour" (e.g. partial bold). The old code sliced within the first
    // node only, leaving "jour" behind: "Salutjour".
    const doc: AnyDoc = {
      id: 1,
      content: lexical([
        { type: 'paragraph', children: [{ type: 'text', text: 'Bon' }, { type: 'text', text: 'jour' }] },
      ]),
    }
    const { payload, updates } = fakePayload(doc)
    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'Bonjour', replacement: 'Salut', offset: 0, length: 7 },
      {},
    )

    expect(res.success).toBe(false)
    expect(updates).toHaveLength(0)
    expect(doc.content.root.children[0].children[0].text).toBe('Bon')
    expect(doc.content.root.children[0].children[1].text).toBe('jour')
  })

  it('does not persist when the replacement did not land at the expected offset', async () => {
    // Same Lexical object reachable twice (hero.richText === content): mutating
    // it shifts the second occurrence, so the write no longer sits where the
    // caller asked. The post-mutation check must catch it and save nothing.
    const shared = lexical([para('Bonjour mondee')])
    const doc: AnyDoc = { id: 1, hero: { richText: shared }, content: shared }

    const fullText = extractAllTextFromDoc(doc, 'content')
    expect(fullText).toBe('Bonjour mondee\nBonjour mondee')

    const { payload, updates } = fakePayload(doc)
    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'mondee', replacement: 'monde', offset: 23, length: 6 },
      {},
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/verification/i)
    expect(updates).toHaveLength(0)
  })
})

describe('applyFix — draft vs published target', () => {
  it('writes back as a draft when the document has a pending draft', async () => {
    const doc: AnyDoc = { id: 1, _status: 'draft', content: lexical([para('Bonjour mondee')]) }
    const { payload, updates } = fakePayload(doc)

    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'mondee', replacement: 'monde', offset: 8, length: 6 },
      {},
    )

    expect(res.success).toBe(true)
    expect(res.target).toBe('draft')
    expect(updates[0].draft).toBe(true)
  })

  it('writes back as published when the latest version is published', async () => {
    const doc: AnyDoc = { id: 1, _status: 'published', content: lexical([para('Bonjour mondee')]) }
    const { payload, updates } = fakePayload(doc)

    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'mondee', replacement: 'monde', offset: 8, length: 6 },
      {},
    )

    expect(res.success).toBe(true)
    expect(res.target).toBe('published')
    expect(updates[0].draft).toBeUndefined()
  })

  it('flags the update so the afterChange hook does not re-check in a loop', async () => {
    const doc: AnyDoc = { id: 1, content: lexical([para('Bonjour mondee')]) }
    const { payload, updates } = fakePayload(doc)

    await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'mondee', replacement: 'monde', offset: 8, length: 6 },
      {},
    )

    expect(updates[0].context).toEqual({ skipSpellcheck: true })
  })
})

describe('applyFix — strict mode', () => {
  const doc = () => ({
    id: 1,
    content: lexical([para('Le chien dort. Le chien mange.')]),
  })

  it('falls back to a closest-match search when not strict', async () => {
    const d = doc()
    const { payload, updates } = fakePayload(d)
    // Stale offset: nothing matches "chien" at 100.
    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'chien', replacement: 'chat', offset: 100, length: 5 },
      {},
    )

    expect(res.success).toBe(true)
    expect(res.method).toBe('search')
    expect(updates).toHaveLength(1)
  })

  it('refuses the same stale offset in strict mode and saves nothing', async () => {
    const d = doc()
    const { payload, updates } = fakePayload(d)
    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'chien', replacement: 'chat', offset: 100, length: 5, strict: true },
      {},
    )

    expect(res.success).toBe(false)
    expect(updates).toHaveLength(0)
    expect(d.content.root.children[0].children[0].text).toBe('Le chien dort. Le chien mange.')
  })

  it('refuses in strict mode when offset/length are missing', async () => {
    const d = doc()
    const { payload, updates } = fakePayload(d)
    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'chien', replacement: 'chat', strict: true },
      {},
    )

    expect(res.success).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('still applies a strict fix when the offset is exact', async () => {
    const d = doc()
    const { payload, updates } = fakePayload(d)
    const res = await applyFix(
      payload,
      { id: 1, collection: 'pages', original: 'chien', replacement: 'chat', offset: 3, length: 5, strict: true },
      {},
    )

    expect(res.success).toBe(true)
    expect(res.method).toBe('offset')
    expect(d.content.root.children[0].children[0].text).toBe('Le chat dort. Le chien mange.')
    expect(updates).toHaveLength(1)
  })
})

// ─── /fix-all batch ─────────────────────────────────────────────────────

function issueOf(
  original: string,
  offset: number,
  length: number,
  replacements: string[],
): SpellCheckIssue {
  return {
    ruleId: `RULE_${offset}`,
    category: 'TYPOS',
    message: '',
    context: '',
    contextOffset: 0,
    offset,
    length,
    original,
    replacements,
    source: 'languagetool',
  }
}

/** Fake Payload serving both the target document and its stored result. */
function fixAllPayload(doc: AnyDoc, issues: SpellCheckIssue[]) {
  const stored = { id: 99, docId: String(doc.id), collection: 'pages', issues, ignoredIssues: [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any[] = []
  const payload = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    find: async (args: any) => {
      if (args.collection === 'spellcheck-results') return { docs: [stored] }
      if (args.collection === 'pages') return { docs: [doc] }
      return { docs: [] }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: async (args: any) => {
      updates.push(args)
      return args.collection === 'pages' ? doc : stored
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: async (args: any) => ({ id: 100, ...args.data }),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as Payload
  return { payload, updates, stored }
}

function fixAllReq(payload: Payload, body: Record<string, unknown>): AnyDoc {
  return {
    headers: new Headers(),
    user: { id: 1, role: 'admin' },
    payload,
    json: async () => body,
  }
}

describe('/fix-all — offset drift inside the batch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies two corrections of different lengths on the same document', async () => {
    // The post-batch re-check must not hit the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ matches: [] }) })),
    )

    // "developement" -> "développement" is one character LONGER: every offset
    // after it drifts by +1. Applied front-to-back, the second fix no longer
    // matches its stored offset and strict mode rejects it — "Tout corriger"
    // then fixed exactly one mistake per click.
    const doc: AnyDoc = {
      id: 1,
      content: lexical([para('Le developement et la maintenence du site.')]),
    }
    const issues = [
      issueOf('developement', 3, 12, ['développement']),
      issueOf('maintenence', 22, 11, ['maintenance']),
    ]

    const { payload } = fixAllPayload(doc, issues)
    const handler = createFixAllHandler({ collections: ['pages'] })
    const res = await handler(fixAllReq(payload, { id: 1, collection: 'pages' }))
    const body = await res.json()

    expect(body.applied).toBe(2)
    expect(body.failed).toBe(0)
    expect(doc.content.root.children[0].children[0].text).toBe(
      'Le développement et la maintenance du site.',
    )
  })
})

// ─── /fix keeps the stored offsets usable ───────────────────────────────

describe('realignIssues', () => {
  const issues = [
    issueOf('developement', 3, 12, ['développement']),
    issueOf('maintenence', 22, 11, ['maintenance']),
  ]

  it('shifts what follows the correction and drops what it overwrote', () => {
    // "developement" (12) -> "développement" (13): everything after moves by +1.
    const next = realignIssues(issues, { offset: 3, length: 12, replacementLength: 13 })

    expect(next).toHaveLength(1)
    expect(next[0].original).toBe('maintenence')
    expect(next[0].offset).toBe(23)
  })

  it('leaves the issues placed before the correction untouched', () => {
    const next = realignIssues(issues, { offset: 22, length: 11, replacementLength: 11 })

    expect(next).toHaveLength(1)
    expect(next[0].original).toBe('developement')
    expect(next[0].offset).toBe(3)
  })
})

describe('/fix — stored issues after a single correction', () => {
  it('re-aligns the offsets left in the database instead of freezing them', async () => {
    const doc: AnyDoc = {
      id: 1,
      content: lexical([para('Le developement et la maintenence du site.')]),
    }
    const issues = [
      issueOf('developement', 3, 12, ['développement']),
      issueOf('maintenence', 22, 11, ['maintenance']),
    ]
    const { payload, updates } = fixAllPayload(doc, issues)

    const handler = createFixHandler({ collections: ['pages'] })
    const res = await handler(
      fixAllReq(payload, {
        id: 1,
        collection: 'pages',
        original: 'developement',
        replacement: 'développement',
        offset: 3,
        length: 12,
      }),
    )
    const body = await res.json()
    expect(body.success).toBe(true)

    // The document write, then the re-aligned spellcheck-results write.
    const resultWrite = updates.find((u) => u.collection === 'spellcheck-results')
    expect(resultWrite).toBeDefined()
    expect(resultWrite.data.issues).toHaveLength(1)
    expect(resultWrite.data.issues[0].original).toBe('maintenence')
    // "developement" -> "développement" is one char longer.
    expect(resultWrite.data.issues[0].offset).toBe(23)

    // And that offset is the real one: a strict fix must now land.
    const strict = await applyFix(
      payload,
      {
        id: 1,
        collection: 'pages',
        original: 'maintenence',
        replacement: 'maintenance',
        offset: resultWrite.data.issues[0].offset,
        length: 11,
        strict: true,
      },
      {},
    )
    expect(strict.success).toBe(true)
    expect(doc.content.root.children[0].children[0].text).toBe(
      'Le développement et la maintenance du site.',
    )
  })
})
