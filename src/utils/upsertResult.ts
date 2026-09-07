/**
 * Shared upsert pattern for spellcheck results.
 * Finds an existing result by docId + collection, then updates or creates.
 */

import type { Payload } from 'payload'

/**
 * Per-(collection, docId) write queue.
 *
 * The upsert below is a find-then-create, not an atomic operation, and there is
 * no unique constraint on (docId, collection). Two concurrent checks of the same
 * document — the afterChange hook racing a manual /validate, or a bulk scan
 * racing a save — both saw "no row" and both created one, leaving duplicates the
 * dashboard then shows twice. Serialising by key removes the race inside a
 * single process (which is the deployment target: the rate limiter and the bulk
 * job state are process-local too).
 */
const writeChains = new Map<string, Promise<unknown>>()

function serializeByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(key) ?? Promise.resolve()
  // Run whether the previous write resolved or rejected — one failure must not
  // block every later write for the same document.
  const next = previous.then(task, task)
  const tail = next.then(
    () => {},
    () => {},
  )
  writeChains.set(key, tail)
  void tail.then(() => {
    // Only the last writer in the chain clears the entry.
    if (writeChains.get(key) === tail) writeChains.delete(key)
  })
  return next
}

/**
 * Upsert a spellcheck result — find existing by docId + collection, update or create.
 * Returns the upserted document. Writes to the same document are serialised.
 */
export function upsertSpellcheckResult(
  payload: Payload,
  docId: string,
  docCollection: string,
  resultData: Record<string, unknown>,
): Promise<{ id: string | number; isNew: boolean }> {
  return serializeByKey(`${docCollection}:${docId}`, () =>
    upsertSpellcheckResultUnsafe(payload, docId, docCollection, resultData),
  )
}

async function upsertSpellcheckResultUnsafe(
  payload: Payload,
  docId: string,
  docCollection: string,
  resultData: Record<string, unknown>,
): Promise<{ id: string | number; isNew: boolean }> {
  const existing = await payload.find({
    collection: 'spellcheck-results',
    where: {
      docId: { equals: docId },
      collection: { equals: docCollection },
    },
    limit: 1,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) {
    const doc = await payload.update({
      collection: 'spellcheck-results',
      id: existing.docs[0].id,
      data: resultData,
      overrideAccess: true,
    })
    return { id: doc.id, isNew: false }
  }

  const doc = await payload.create({
    collection: 'spellcheck-results',
    data: { docId, collection: docCollection, ...resultData },
    overrideAccess: true,
  })
  return { id: doc.id, isNew: true }
}

/**
 * Find an existing spellcheck result for a document.
 * Returns the doc or null.
 */
export async function findSpellcheckResult(
  payload: Payload,
  docId: string,
  docCollection: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  try {
    const existing = await payload.find({
      collection: 'spellcheck-results',
      where: {
        docId: { equals: docId },
        collection: { equals: docCollection },
      },
      limit: 1,
      overrideAccess: true,
    })
    return existing.docs.length > 0 ? existing.docs[0] : null
  } catch {
    return null
  }
}
