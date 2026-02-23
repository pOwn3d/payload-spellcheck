/**
 * Bulk endpoint — scan all documents in configured collections.
 * POST /api/spellcheck/bulk — starts scan in background, returns immediately
 * GET  /api/spellcheck/status — returns current scan progress
 *
 * Sequential processing to respect LanguageTool rate limits (3s between requests).
 * Scan continues server-side even if the user leaves the page.
 */

import type { Payload, PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig, SpellCheckResult } from '../types.js'
import { extractAllTextFromDoc, countWords } from '../engine/lexicalParser.js'
import { checkWithLanguageTool } from '../engine/languagetool.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'

const RATE_LIMIT_DELAY = 3_000 // 3 seconds between LanguageTool API calls
const STALE_TIMEOUT = 10 * 60 * 1000 // 10 minutes — consider job dead if no progress

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** In-memory scan job state (single-process Node.js) */
interface ScanJob {
  status: 'running' | 'completed' | 'error'
  current: number
  total: number
  currentDoc: string
  totalIssues: number
  totalDocuments: number
  averageScore: number
  startedAt: string
  completedAt: string | null
  error: string | null
  lastActivity: number // timestamp of last progress update
}

// Module-level state — persists across requests
let currentJob: ScanJob | null = null

/** Check if the current job is stale (no progress for STALE_TIMEOUT) */
function isJobStale(): boolean {
  if (!currentJob || currentJob.status !== 'running') return false
  return Date.now() - currentJob.lastActivity > STALE_TIMEOUT
}

/** Reset the job if stale */
function resetIfStale(): void {
  if (isJobStale() && currentJob) {
    console.warn(`[spellcheck/bulk] Job stale (no progress for ${STALE_TIMEOUT / 1000}s), auto-resetting`)
    currentJob.status = 'error'
    currentJob.error = 'Scan timed out (no progress)'
    currentJob.completedAt = new Date().toISOString()
  }
}

/**
 * Run the bulk scan in background. Updates `currentJob` as it progresses.
 */
async function runBulkScan(
  payload: Payload,
  collectionsToScan: string[],
  idsFilter: Array<{ id: string; collection: string }> | null,
  pluginConfig: SpellCheckPluginConfig,
): Promise<void> {
  const language = pluginConfig.language || 'fr'
  const contentField = pluginConfig.contentField || 'content'
  const results: SpellCheckResult[] = []

  try {
    // First pass: count total documents
    let totalToScan = 0
    const docsByCollection: Map<string, Array<{ id: string | number; [k: string]: unknown }>> = new Map()

    for (const collectionSlug of collectionsToScan) {
      const idsForCollection = idsFilter
        ? idsFilter.filter((i) => i.collection === collectionSlug).map((i) => i.id)
        : null

      const allDocs = await payload.find({
        collection: collectionSlug,
        limit: 0,
        depth: 1,
        draft: true, // Read latest version (including unpublished edits)
        overrideAccess: true,
        where: {
          ...(idsForCollection
            ? { id: { in: idsForCollection } }
            : { _status: { equals: 'published' } }),
        },
      })

      docsByCollection.set(collectionSlug, allDocs.docs)
      totalToScan += allDocs.docs.length
    }

    if (currentJob) {
      currentJob.total = totalToScan
      currentJob.lastActivity = Date.now()
    }

    // Second pass: scan each document
    let processed = 0
    let totalIssues = 0
    let skipped = 0

    for (const collectionSlug of collectionsToScan) {
      const docs = docsByCollection.get(collectionSlug) || []

      for (const doc of docs) {
        processed++
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const docAny = doc as any
        const docTitle = docAny.title || docAny.slug || String(doc.id)

        // Update progress
        if (currentJob) {
          currentJob.current = processed
          currentJob.currentDoc = docTitle
          currentJob.lastActivity = Date.now()
        }

        // Wrap each doc in try/catch — one failure doesn't kill the scan
        try {
          const text = extractAllTextFromDoc(docAny, contentField)

          if (!text.trim()) {
            skipped++
            continue
          }

          const wordCount = countWords(text)

          // Check with LanguageTool
          let issues = await checkWithLanguageTool(text, language, pluginConfig)
          issues = await filterFalsePositives(issues, pluginConfig, payload)

          const score = calculateScore(wordCount, issues.length)
          totalIssues += issues.length

          const result: SpellCheckResult = {
            docId: String(doc.id),
            collection: collectionSlug,
            score,
            issueCount: issues.length,
            wordCount,
            issues,
            lastChecked: new Date().toISOString(),
          }
          results.push(result)

          // Store/update result in collection
          try {
            const existing = await payload.find({
              collection: 'spellcheck-results',
              where: {
                docId: { equals: String(doc.id) },
                collection: { equals: collectionSlug },
              },
              limit: 1,
              overrideAccess: true,
            })

            const resultData = {
              docId: String(doc.id),
              collection: collectionSlug,
              title: docAny.title || '',
              slug: docAny.slug || '',
              score,
              issueCount: issues.length,
              wordCount,
              issues: issues as unknown as Record<string, unknown>[],
              lastChecked: new Date().toISOString(),
            }

            if (existing.docs.length > 0) {
              await payload.update({
                collection: 'spellcheck-results',
                id: existing.docs[0].id,
                data: resultData,
                overrideAccess: true,
              })
            } else {
              await payload.create({
                collection: 'spellcheck-results',
                data: resultData,
                overrideAccess: true,
              })
            }
          } catch (err) {
            console.error(`[spellcheck/bulk] Failed to store result for ${docTitle}:`, err)
          }
        } catch (docErr) {
          console.error(`[spellcheck/bulk] Error processing "${docTitle}":`, docErr)
          // Continue to next doc instead of crashing the entire scan
        }

        // Update running totals
        if (currentJob) {
          currentJob.totalIssues = totalIssues
          currentJob.totalDocuments = processed
          currentJob.lastActivity = Date.now()
        }

        // Rate limit delay
        await sleep(RATE_LIMIT_DELAY)
      }
    }

    // Mark completed
    const averageScore = results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
      : 100

    if (currentJob) {
      currentJob.status = 'completed'
      currentJob.completedAt = new Date().toISOString()
      currentJob.averageScore = averageScore
      currentJob.totalDocuments = processed
      currentJob.totalIssues = totalIssues
      currentJob.lastActivity = Date.now()
    }

    console.log(`[spellcheck/bulk] Scan completed: ${processed} docs (${skipped} skipped), ${totalIssues} issues, avg score ${averageScore}`)
  } catch (error) {
    console.error('[spellcheck/bulk] Scan error:', error)
    if (currentJob) {
      currentJob.status = 'error'
      currentJob.error = (error as Error).message
      currentJob.completedAt = new Date().toISOString()
      currentJob.lastActivity = Date.now()
    }
  }
}

/**
 * POST handler — start a bulk scan in background.
 * Body: { collection?, ids?, force? }
 * - force: true — reset any stuck scan and start fresh
 */
export function createBulkHandler(
  targetCollections: string[],
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Auto-reset stale jobs
      resetIfStale()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json().catch(() => ({}))
      const { collection: targetCollection, ids, force } = body as {
        collection?: string
        ids?: Array<{ id: string; collection: string }>
        force?: boolean
      }

      // If a scan is already running, reject (unless force=true)
      if (currentJob?.status === 'running') {
        if (force) {
          console.warn('[spellcheck/bulk] Force-resetting stuck scan')
          currentJob.status = 'error'
          currentJob.error = 'Force reset by user'
          currentJob.completedAt = new Date().toISOString()
        } else {
          return Response.json({
            error: 'Scan already in progress',
            ...currentJob,
          }, { status: 409 })
        }
      }

      const scanSpecificIds = Array.isArray(ids) && ids.length > 0

      const collectionsToScan = scanSpecificIds
        ? [...new Set(ids!.map((i) => i.collection))]
        : targetCollection
          ? [targetCollection]
          : targetCollections

      const idsFilter = scanSpecificIds ? ids! : null

      // Initialize job
      currentJob = {
        status: 'running',
        current: 0,
        total: 0,
        currentDoc: '',
        totalIssues: 0,
        totalDocuments: 0,
        averageScore: 0,
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
        lastActivity: Date.now(),
      }

      // Fire-and-forget — scan runs in background
      runBulkScan(req.payload, collectionsToScan, idsFilter, pluginConfig)

      return Response.json({
        message: 'Scan started',
        status: 'running',
      })
    } catch (error) {
      console.error('[spellcheck/bulk] Error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}

/**
 * GET handler — return current scan status/progress.
 */
export function createStatusHandler(): PayloadHandler {
  return async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Auto-reset stale jobs
    resetIfStale()

    if (!currentJob) {
      return Response.json({ status: 'idle' })
    }

    return Response.json({ ...currentJob })
  }
}
