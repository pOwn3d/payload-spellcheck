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
import { analyzeReadability } from '../engine/readability.js'
import { checkConsistency } from '../engine/consistency.js'
import { upsertSpellcheckResult, findSpellcheckResult } from '../utils/upsertResult.js'
import { filterIgnoredIssues, type IgnoredIssue } from '../utils/filterIgnored.js'

const DEFAULT_RATE_LIMIT_DELAY = 3_000 // 3 seconds between LanguageTool API calls
const DEFAULT_STALE_TIMEOUT = 10 * 60 * 1000 // 10 minutes — consider job dead if no progress

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

/** Check if the current job is stale (no progress for staleTimeout) */
function isJobStale(staleTimeout: number): boolean {
  if (!currentJob || currentJob.status !== 'running') return false
  return Date.now() - currentJob.lastActivity > staleTimeout
}

/** Reset the job if stale */
function resetIfStale(staleTimeout: number = DEFAULT_STALE_TIMEOUT): void {
  if (isJobStale(staleTimeout) && currentJob) {
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
  const rateLimitDelay = pluginConfig.timeouts?.bulkRateLimitDelay ?? DEFAULT_RATE_LIMIT_DELAY
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
        depth: 0, // depth:0 — must match fix.ts for offset alignment
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

          // Load existing result to get ignoredIssues
          const existingDoc = await findSpellcheckResult(payload, String(doc.id), collectionSlug)
          const ignoredIssues: IgnoredIssue[] = Array.isArray(existingDoc?.ignoredIssues) ? existingDoc.ignoredIssues : []

          // Filter out user-ignored issues (persistent across rescans)
          issues = filterIgnoredIssues(issues, ignoredIssues)

          const score = calculateScore(wordCount, issues.length)
          totalIssues += issues.length

          // Run readability analysis
          const readability = analyzeReadability(text, (language === 'en' ? 'en' : 'fr') as 'fr' | 'en')

          // Run consistency check
          const consistency = checkConsistency(text)

          const result: SpellCheckResult = {
            docId: String(doc.id),
            collection: collectionSlug,
            score,
            issueCount: issues.length,
            wordCount,
            issues,
            readability,
            consistency,
            lastChecked: new Date().toISOString(),
          }
          results.push(result)

          // Store/update result in collection (preserve ignoredIssues)
          try {
            await upsertSpellcheckResult(payload, String(doc.id), collectionSlug, {
              title: docAny.title || '',
              slug: docAny.slug || '',
              score,
              issueCount: issues.length,
              wordCount,
              issues: issues as unknown as Record<string, unknown>[],
              ignoredIssues: ignoredIssues as unknown as Record<string, unknown>[],
              readability: readability as unknown as Record<string, unknown>,
              consistency: consistency as unknown as Record<string, unknown>[],
              lastChecked: new Date().toISOString(),
            })
          } catch (err) {
            payload.logger.error(`[spellcheck/bulk] Failed to store result for ${docTitle}: ${err instanceof Error ? err.message : err}`)
          }
        } catch (docErr) {
          payload.logger.error(`[spellcheck/bulk] Error processing "${docTitle}": ${docErr instanceof Error ? docErr.message : docErr}`)
          // Continue to next doc instead of crashing the entire scan
        }

        // Update running totals
        if (currentJob) {
          currentJob.totalIssues = totalIssues
          currentJob.totalDocuments = processed
          currentJob.lastActivity = Date.now()
        }

        // Rate limit delay
        await sleep(rateLimitDelay)
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

    payload.logger.info(`[spellcheck/bulk] Scan completed: ${processed} docs (${skipped} skipped), ${totalIssues} issues, avg score ${averageScore}`)
  } catch (error) {
    payload.logger.error(`[spellcheck/bulk] Scan error: ${error instanceof Error ? error.message : error}`)
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
      // RBAC: check access (default: admin only)
      const accessFn = pluginConfig.access || ((r: { user?: Record<string, unknown> | null }) => {
        const u = r.user as Record<string, unknown> | null | undefined
        return Boolean(u?.role === 'admin' || (Array.isArray(u?.roles) && (u!.roles as string[]).includes('admin')))
      })
      if (!req.user || !accessFn(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 403 })
      }

      const staleTimeout = pluginConfig.timeouts?.bulkStaleTimeout ?? DEFAULT_STALE_TIMEOUT

      // Auto-reset stale jobs
      resetIfStale(staleTimeout)

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
          req.payload.logger.warn('[spellcheck/bulk] Force-resetting stuck scan')
          currentJob.status = 'error'
          currentJob.error = 'Force reset by user'
          currentJob.completedAt = new Date().toISOString()
        } else {
          return Response.json({
            ...currentJob,
            error: 'Scan already in progress',
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
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/bulk] Error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

/**
 * GET handler — return current scan status/progress.
 */
export function createStatusHandler(pluginConfig?: SpellCheckPluginConfig): PayloadHandler {
  return async (req) => {
    // RBAC: check access (default: admin only)
    const accessFn = pluginConfig?.access || ((r: { user?: Record<string, unknown> | null }) => {
      const u = r.user as Record<string, unknown> | null | undefined
      return Boolean(u?.role === 'admin' || (Array.isArray(u?.roles) && (u!.roles as string[]).includes('admin')))
    })
    if (!req.user || !accessFn(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const staleTimeout = pluginConfig?.timeouts?.bulkStaleTimeout ?? DEFAULT_STALE_TIMEOUT

    // Auto-reset stale jobs
    resetIfStale(staleTimeout)

    if (!currentJob) {
      return Response.json({ status: 'idle' })
    }

    return Response.json({ ...currentJob })
  }
}
