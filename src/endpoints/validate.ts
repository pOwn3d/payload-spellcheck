/**
 * Validate endpoint — check a single document for spelling/grammar issues.
 * POST /api/spellcheck/validate
 * Body: { id, collection } or { text, language }
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig, SpellCheckIssue, SpellCheckResult } from '../types.js'
import { extractAllTextFromDoc, countWords } from '../engine/lexicalParser.js'
import { runLanguageToolCheck } from '../engine/languagetool.js'
import { runClaudeCheck } from '../engine/claude.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'
import { analyzeReadability, type ReadabilityResult } from '../engine/readability.js'
import { checkConsistency, type ConsistencyIssue } from '../engine/consistency.js'
import { upsertSpellcheckResult, findSpellcheckResult } from '../utils/upsertResult.js'
import { filterIgnoredIssues, type IgnoredIssue } from '../utils/filterIgnored.js'
import { createAccessGuard } from './access.js'

/** Maximum text length accepted for validation (characters) */
const MAX_TEXT_LENGTH = 50_000

export function createValidateHandler(
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  const guard = createAccessGuard(pluginConfig)
  return async (req) => {
    try {
      // RBAC: check access (default: admin only)
      if (!guard.isAllowed(req)) return guard.forbidden()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json().catch(() => ({}))
      const {
        id,
        collection,
        text: rawText,
        language: bodyLanguage,
      } = body as {
        id?: string | number
        collection?: string
        text?: string
        language?: string
      }

      // Validate collection against allowed list to prevent injection
      const allowedCollections = pluginConfig.collections ?? ['pages', 'posts']
      if (collection && !allowedCollections.includes(collection)) {
        return Response.json({ error: 'Collection not allowed' }, { status: 403 })
      }

      const language = bodyLanguage || pluginConfig.language || 'fr'
      const contentField = pluginConfig.contentField || 'content'
      let textToCheck: string

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fetchedDoc: any = null

      if (rawText) {
        // Input validation: reject overly long raw text
        if (rawText.length > MAX_TEXT_LENGTH) {
          return Response.json(
            { error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters (received ${rawText.length})` },
            { status: 400 },
          )
        }
        // Direct text check (no doc lookup)
        textToCheck = rawText
      } else if (id && collection) {
        // Input validation
        if (typeof collection !== 'string' || !collection.trim()) {
          return Response.json({ error: 'collection must be a non-empty string' }, { status: 400 })
        }
        if (id !== undefined && (typeof id !== 'string' && typeof id !== 'number' || !String(id).trim())) {
          return Response.json({ error: 'id must be a non-empty string' }, { status: 400 })
        }

        // Use payload.find() — NOT findByID() — to match bulk.ts exactly.
        const findResult = await req.payload.find({
          collection,
          where: { id: { equals: id } },
          limit: 1,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        if (!findResult.docs.length) {
          return Response.json({ error: 'Document not found' }, { status: 404 })
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetchedDoc = findResult.docs[0] as any
        textToCheck = extractAllTextFromDoc(fetchedDoc, contentField)

        // Input validation: reject documents with overly long extracted text
        if (textToCheck.length > MAX_TEXT_LENGTH) {
          return Response.json(
            { error: `Extracted text exceeds maximum length of ${MAX_TEXT_LENGTH} characters (got ${textToCheck.length})` },
            { status: 400 },
          )
        }
      } else {
        return Response.json(
          { error: 'Provide { id, collection } or { text }' },
          { status: 400 },
        )
      }

      const wordCount = countWords(textToCheck)

      // Check with LanguageTool.
      // A failed call must NOT be reported as "0 issue / score 100" and stored
      // over a previous result that held real mistakes — fail loudly instead.
      const ltOutcome = await runLanguageToolCheck(textToCheck, language, pluginConfig, req.payload.logger)
      if (!ltOutcome.ok) {
        return Response.json(
          {
            error: `Spellcheck engine unavailable: ${ltOutcome.reason}`,
            checkFailed: true,
          },
          { status: 502 },
        )
      }
      let issues: SpellCheckIssue[] = ltOutcome.issues

      // Optional Claude fallback for semantic issues.
      // Non-fatal: Claude only enriches the LanguageTool result, so a failure
      // degrades the answer instead of invalidating it.
      if (pluginConfig.enableAiFallback && pluginConfig.anthropicApiKey) {
        const claudeOutcome = await runClaudeCheck(
          textToCheck,
          language,
          pluginConfig.anthropicApiKey,
          pluginConfig,
          req.payload.logger,
        )
        if (claudeOutcome.ok) {
          issues = [...issues, ...claudeOutcome.issues]
        } else {
          req.payload.logger.warn(
            `[spellcheck/validate] Claude fallback skipped: ${claudeOutcome.reason}`,
          )
        }
      }

      // Filter false positives (async — loads dynamic dictionary from DB)
      issues = await filterFalsePositives(issues, pluginConfig, req.payload)

      // Load existing result to get ignoredIssues (persistent ignore)
      let ignoredIssues: IgnoredIssue[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let existingDoc: any = null
      if (id && collection) {
        existingDoc = await findSpellcheckResult(req.payload, String(id), collection)
        if (existingDoc) {
          ignoredIssues = Array.isArray(existingDoc.ignoredIssues) ? existingDoc.ignoredIssues : []
        }
      }

      // Filter out user-ignored issues
      issues = filterIgnoredIssues(issues, ignoredIssues)

      const score = calculateScore(wordCount, issues.length)

      // Run readability analysis
      const readability = analyzeReadability(textToCheck, (language === 'en' ? 'en' : 'fr') as 'fr' | 'en')

      // Run consistency check
      const consistency = checkConsistency(textToCheck)

      // Store result if we have a doc ID
      if (id && collection) {
        try {
          const title = fetchedDoc?.title as string || ''
          const slug = fetchedDoc?.slug as string || ''

          await upsertSpellcheckResult(req.payload, String(id), collection, {
            title,
            slug,
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
          req.payload.logger.error(`[spellcheck] Failed to store result: ${err instanceof Error ? err.message : err}`)
        }
      }

      const result: SpellCheckResult = {
        docId: id ? String(id) : '',
        collection: collection || '',
        score,
        issueCount: issues.length,
        wordCount,
        issues,
        readability,
        consistency,
        lastChecked: new Date().toISOString(),
      }

      return Response.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[spellcheck/validate] Error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
