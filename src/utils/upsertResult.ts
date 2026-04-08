/**
 * Shared upsert pattern for spellcheck results.
 * Finds an existing result by docId + collection, then updates or creates.
 */

import type { Payload } from 'payload'

/**
 * Upsert a spellcheck result — find existing by docId + collection, update or create.
 * Returns the upserted document.
 */
export async function upsertSpellcheckResult(
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
