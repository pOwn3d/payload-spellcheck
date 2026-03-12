/**
 * Dictionary endpoints — CRUD for the dynamic spellcheck dictionary.
 * GET  /api/spellcheck/dictionary — list all words
 * POST /api/spellcheck/dictionary — add word(s)
 * DELETE /api/spellcheck/dictionary — delete word(s) by id
 */

import type { PayloadHandler } from 'payload'

/** Maximum word length allowed in the dictionary */
const MAX_WORD_LENGTH = 100

/**
 * GET — list all dictionary words sorted alphabetically.
 */
export function createDictionaryListHandler(): PayloadHandler {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const result = await req.payload.find({
        collection: 'spellcheck-dictionary',
        limit: 0,
        sort: 'word',
        overrideAccess: true,
      })

      return Response.json({
        words: result.docs,
        count: result.totalDocs,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/dictionary] List error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

/**
 * POST — add one or more words to the dictionary.
 * Body: { word: string } or { words: string[] }
 */
export function createDictionaryAddHandler(): PayloadHandler {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json().catch(() => ({}))
      const { word, words } = body as { word?: string; words?: string[] }

      // Input validation: word must be a non-empty string
      if (word !== undefined && (typeof word !== 'string' || !word.trim())) {
        return Response.json({ error: 'word must be a non-empty string' }, { status: 400 })
      }

      const wordsToAdd: string[] = []
      if (word) wordsToAdd.push(word)
      if (Array.isArray(words)) wordsToAdd.push(...words)

      if (wordsToAdd.length === 0) {
        return Response.json({ error: 'Provide { word } or { words: [] }' }, { status: 400 })
      }

      // Validate word lengths before processing
      const tooLong = wordsToAdd.filter((w) => w.trim().length > MAX_WORD_LENGTH)
      if (tooLong.length > 0) {
        return Response.json(
          { error: `Word(s) exceed maximum length of ${MAX_WORD_LENGTH} characters: ${tooLong.map((w) => `"${w.trim().slice(0, 20)}…"`).join(', ')}` },
          { status: 400 },
        )
      }

      const added: string[] = []
      const skipped: string[] = []

      for (const w of wordsToAdd) {
        const cleaned = w.trim().toLowerCase()
        if (!cleaned) continue

        try {
          // Check for existing word
          const existing = await req.payload.find({
            collection: 'spellcheck-dictionary',
            where: { word: { equals: cleaned } },
            limit: 1,
            overrideAccess: true,
          })

          if (existing.docs.length > 0) {
            skipped.push(cleaned)
            continue
          }

          await req.payload.create({
            collection: 'spellcheck-dictionary',
            data: {
              word: cleaned,
              addedBy: typeof req.user.id !== 'undefined' ? req.user.id : undefined,
            },
            overrideAccess: true,
          })
          added.push(cleaned)
        } catch (err) {
          // Unique constraint violation = duplicate, skip
          skipped.push(cleaned)
        }
      }

      // Invalidate the dictionary cache
      invalidateDictionaryCache()

      return Response.json({ added, skipped, count: added.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/dictionary] Add error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

/**
 * DELETE — remove word(s) from the dictionary by ID.
 * Body: { id: string } or { ids: string[] }
 */
export function createDictionaryDeleteHandler(): PayloadHandler {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json().catch(() => ({}))
      const { id: bodyId, ids, word } = body as { id?: string; ids?: string[]; word?: string }

      // Also accept ?id=xxx in query string (for simple DELETE requests)
      const url = new URL(req.url || '', 'http://localhost')
      const queryId = url.searchParams.get('id')

      const idsToDelete: string[] = []
      if (bodyId) idsToDelete.push(bodyId)
      if (queryId) idsToDelete.push(queryId)
      if (Array.isArray(ids)) idsToDelete.push(...ids)

      // Support deleting by word (lookup ID first)
      if (word && typeof word === 'string' && word.trim()) {
        const found = await req.payload.find({
          collection: 'spellcheck-dictionary',
          where: { word: { equals: word.trim().toLowerCase() } },
          limit: 1,
          overrideAccess: true,
        })
        if (found.docs.length > 0) {
          idsToDelete.push(String(found.docs[0].id))
        }
      }

      if (idsToDelete.length === 0) {
        return Response.json({ error: 'Provide { id }, { ids: [] }, or { word }' }, { status: 400 })
      }

      let deleted = 0
      for (const deleteId of idsToDelete) {
        try {
          await req.payload.delete({
            collection: 'spellcheck-dictionary',
            id: deleteId,
            overrideAccess: true,
          })
          deleted++
        } catch {
          // ID not found, skip
        }
      }

      // Invalidate the dictionary cache
      invalidateDictionaryCache()

      return Response.json({ deleted })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/dictionary] Delete error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

// --- In-memory dictionary cache (5 min TTL) ---

let cachedWords: string[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function invalidateDictionaryCache(): void {
  cachedWords = null
  cacheTimestamp = 0
}

/**
 * Load dictionary words from DB with in-memory cache.
 * Returns lowercased word strings.
 */
export async function loadDictionaryWords(
  payload: { find: Function },
): Promise<string[]> {
  const now = Date.now()
  if (cachedWords && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedWords
  }

  try {
    const result = await payload.find({
      collection: 'spellcheck-dictionary',
      limit: 0,
      overrideAccess: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cachedWords = result.docs.map((doc: any) => (doc.word as string).toLowerCase())
    cacheTimestamp = now
    return cachedWords!
  } catch {
    // Collection might not exist yet (first run before DB sync)
    return []
  }
}
