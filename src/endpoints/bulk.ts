/**
 * Bulk endpoint — scan all documents in configured collections.
 * POST /api/spellcheck/bulk — starts scan in background, returns immediately
 * GET  /api/spellcheck/status — returns current scan progress
 *
 * Sequential processing to respect LanguageTool rate limits (3s between requests).
 * Scan continues server-side even if the user leaves the page.
 */

import type { Payload, PayloadHandler, Where } from 'payload'
import type { SpellCheckPluginConfig, SpellCheckResult } from '../types.js'
import { extractAllTextFromDoc, countWords } from '../engine/lexicalParser.js'
import { runLanguageToolCheck } from '../engine/languagetool.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'
import { analyzeReadability } from '../engine/readability.js'
import { checkConsistency } from '../engine/consistency.js'
import { upsertSpellcheckResult, findSpellcheckResult } from '../utils/upsertResult.js'
import { filterIgnoredIssues, type IgnoredIssue } from '../utils/filterIgnored.js'
import { createAccessGuard } from './access.js'

const DEFAULT_RATE_LIMIT_DELAY = 3_000 // 3 seconds between LanguageTool API calls
const DEFAULT_STALE_TIMEOUT = 10 * 60 * 1000 // 10 minutes — consider job dead if no progress

/**
 * Documents fetched per query during the scan.
 *
 * The scan used to start with `payload.find({ limit: 0 })` per collection —
 * "no limit" in Payload — and kept every document, full Lexical trees included,
 * in a Map for the whole run. With a 3 s pause between documents that meant
 * holding the entire corpus in memory for roughly `docs × 3 s`: about 50
 * minutes on a thousand pages. Now a page is loaded, processed and dropped
 * before the next one is fetched, so the resident set is bounded by PAGE_SIZE.
 */
const PAGE_SIZE = 200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Query shape reused by both passes of a scan, per collection. */
interface CollectionScanPlan {
  hasDrafts: boolean
  where: Where
}

/** In-memory scan job state (single-process Node.js) */
interface ScanJob {
  status: 'running' | 'completed' | 'error'
  current: number
  total: number
  currentDoc: string
  totalIssues: number
  totalDocuments: number
  /** Documents whose check could not run (LanguageTool unreachable, query error) */
  failed: number
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
  // Running average only: keeping every SpellCheckResult (issues included) for
  // the whole run was the second half of the memory problem.
  let scoreSum = 0
  let scoredDocs = 0

  const configuredMaxDocs = pluginConfig.maxDocs
  const maxDocs =
    typeof configuredMaxDocs === 'number' && configuredMaxDocs > 0
      ? configuredMaxDocs
      : Number.POSITIVE_INFINITY

  try {
    // First pass: count total documents (one `limit: 1` query per collection —
    // only `totalDocs` is read, no document is materialised here).
    let totalToScan = 0
    const plans: Map<string, CollectionScanPlan> = new Map()

    for (const collectionSlug of collectionsToScan) {
      // Isolate each collection: a single bad query used to abort the whole scan
      // (status 'error', zero document processed). Same pattern as the per-doc
      // try/catch further down.
      try {
        const idsForCollection = idsFilter
          ? idsFilter.filter((i) => i.collection === collectionSlug).map((i) => i.id)
          : null

        // `_status` only exists on collections with versions.drafts enabled.
        // Querying it elsewhere throws a QueryError from validateQueryPaths —
        // which overrideAccess does NOT bypass — and a collection without drafts
        // is a perfectly ordinary configuration.
        const hasDrafts = Boolean(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload.collections as any)?.[collectionSlug]?.config?.versions?.drafts,
        )

        const where: Where = idsForCollection
          ? { id: { in: idsForCollection } }
          : hasDrafts
            ? { _status: { equals: 'published' } }
            : {}

        const countResult = await payload.find({
          collection: collectionSlug,
          limit: 1,
          depth: 0,
          ...(hasDrafts ? { draft: true } : {}),
          overrideAccess: true,
          where,
        })

        plans.set(collectionSlug, { hasDrafts, where })
        // `totalDocs` is what the counting query is for, but it is an optional
        // field of the adapter's answer: adding an `undefined` to the running
        // total turns it into NaN, and the dashboard then shows a progress bar
        // out of NaN for the whole scan. The scan itself is driven by the pages,
        // not by this number.
        totalToScan +=
          typeof countResult.totalDocs === 'number' && Number.isFinite(countResult.totalDocs)
            ? countResult.totalDocs
            : 0
      } catch (collErr) {
        payload.logger.error(
          `[spellcheck/bulk] Skipping collection "${collectionSlug}": ${collErr instanceof Error ? collErr.message : collErr}`,
        )
      }
    }

    if (totalToScan > maxDocs) {
      payload.logger.warn(
        `[spellcheck/bulk] ${totalToScan} documents match, capping the scan at maxDocs=${maxDocs}`,
      )
      totalToScan = maxDocs
    }

    if (currentJob) {
      currentJob.total = totalToScan
      currentJob.lastActivity = Date.now()
    }

    // Second pass: scan each document
    let processed = 0
    let totalIssues = 0
    let skipped = 0
    let failed = 0

    for (const collectionSlug of collectionsToScan) {
      const plan = plans.get(collectionSlug)
      if (!plan) continue

      let page = 1
      let done = false

      while (!done && processed < maxDocs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pageResult: { docs?: any[]; hasNextPage?: boolean }
        try {
          pageResult = (await payload.find({
            collection: collectionSlug,
            limit: PAGE_SIZE,
            page,
            depth: 0, // depth:0 — must match fix.ts for offset alignment
            // Read latest version (including unpublished edits)
            ...(plan.hasDrafts ? { draft: true } : {}),
            overrideAccess: true,
            where: plan.where,
            // Deterministic paging: without an explicit sort a document saved
            // mid-scan can shift between pages and be skipped or scanned twice.
            sort: 'id',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          })) as any
        } catch (pageErr) {
          payload.logger.error(
            `[spellcheck/bulk] Stopping collection "${collectionSlug}" at page ${page}: ${pageErr instanceof Error ? pageErr.message : pageErr}`,
          )
          break
        }

        const pageDocs = Array.isArray(pageResult?.docs) ? pageResult.docs : []

        // Stop on what the page actually contains, not only on `hasNextPage`.
        // Replacing `limit: 0` with paging made the scan depend on a field the
        // caller does not control: an adapter (or a wrapper around
        // `payload.find`) that omits `hasNextPage` would end the scan after the
        // first 200 documents — a silent half-scan, invisible in the UI, which
        // the unbounded version could not produce. A short page is the end of
        // the collection everywhere; an empty one always is, which also rules
        // out the mirror failure (a permanently `true` flag looping forever).
        if (pageDocs.length === 0) done = true
        else if (pageResult.hasNextPage === false) done = true
        else if (pageResult.hasNextPage === undefined && pageDocs.length < PAGE_SIZE) done = true
        page++

        for (const doc of pageDocs) {
          if (processed >= maxDocs) {
            done = true
            break
          }
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

            // Check with LanguageTool. On failure, count the document as failed
            // and move on: writing a 0-issue / score-100 result would overwrite a
            // previous result that held real mistakes.
            const outcome = await runLanguageToolCheck(text, language, pluginConfig, payload.logger)
            if (!outcome.ok) {
              failed++
              if (currentJob) currentJob.failed = failed
              payload.logger.warn(
                `[spellcheck/bulk] Check failed for "${docTitle}": ${outcome.reason} — result left untouched`,
              )
              await sleep(rateLimitDelay)
              continue
            }
            let issues = await filterFalsePositives(outcome.issues, pluginConfig, payload)

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
            scoreSum += result.score
          scoredDocs++

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
    }

    // Mark completed
    const averageScore = scoredDocs > 0 ? Math.round(scoreSum / scoredDocs) : 100

    if (currentJob) {
      currentJob.status = 'completed'
      currentJob.completedAt = new Date().toISOString()
      currentJob.averageScore = averageScore
      currentJob.totalDocuments = processed
      currentJob.totalIssues = totalIssues
      currentJob.failed = failed
      currentJob.lastActivity = Date.now()
    }

    payload.logger.info(`[spellcheck/bulk] Scan completed: ${processed} docs (${skipped} skipped, ${failed} failed), ${totalIssues} issues, avg score ${averageScore}`)
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
  const guard = createAccessGuard(pluginConfig)
  return async (req) => {
    try {
      // RBAC: check access (default: admin only)
      if (!guard.isAllowed(req)) return guard.forbidden()

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

      // Collection allowlist. /bulk was the only endpoint the 0.13.0 hardening
      // missed: `collection` and every `ids[].collection` went straight into
      // payload.find({ overrideAccess: true }), so any allowed caller could scan
      // an arbitrary collection and ship its text to api.languagetool.org.
      if (targetCollection !== undefined && !targetCollections.includes(targetCollection)) {
        return Response.json({ error: 'Collection not allowed' }, { status: 403 })
      }
      if (Array.isArray(ids)) {
        const hasForbidden = ids.some(
          (entry) =>
            !entry ||
            typeof entry.collection !== 'string' ||
            !targetCollections.includes(entry.collection),
        )
        if (hasForbidden) {
          return Response.json({ error: 'Collection not allowed' }, { status: 403 })
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
        failed: 0,
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
  const guard = createAccessGuard(pluginConfig)
  return async (req) => {
    // RBAC: check access (default: admin only)
    if (!guard.isAllowed(req)) return guard.forbidden()

    const staleTimeout = pluginConfig?.timeouts?.bulkStaleTimeout ?? DEFAULT_STALE_TIMEOUT

    // Auto-reset stale jobs
    resetIfStale(staleTimeout)

    if (!currentJob) {
      return Response.json({ status: 'idle' })
    }

    return Response.json({ ...currentJob })
  }
}
