/**
 * Validate endpoint — check a single document for spelling/grammar issues.
 * POST /api/spellcheck/validate
 * Body: { id, collection } or { text, language }
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig, SpellCheckIssue, SpellCheckResult } from '../types.js'
import { extractAllTextFromDoc, countWords } from '../engine/lexicalParser.js'
import { checkWithLanguageTool } from '../engine/languagetool.js'
import { checkWithClaude } from '../engine/claude.js'
import { filterFalsePositives, calculateScore } from '../engine/filters.js'

// Text extraction is now handled by extractAllTextFromDoc from lexicalParser

export function createValidateHandler(
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

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

      const language = bodyLanguage || pluginConfig.language || 'fr'
      const contentField = pluginConfig.contentField || 'content'
      let textToCheck: string

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fetchedDoc: any = null

      if (rawText) {
        // Direct text check (no doc lookup)
        textToCheck = rawText
      } else if (id && collection) {
        // Fetch doc (depth:0, draft:true — must match bulk.ts/fix.ts for offset alignment)
        fetchedDoc = await req.payload.findByID({
          collection,
          id,
          depth: 0,
          draft: true,
          overrideAccess: true,
        })
        textToCheck = extractAllTextFromDoc(fetchedDoc, contentField)
      } else {
        return Response.json(
          { error: 'Provide { id, collection } or { text }' },
          { status: 400 },
        )
      }

      const wordCount = countWords(textToCheck)

      // Check with LanguageTool
      let issues: SpellCheckIssue[] = await checkWithLanguageTool(textToCheck, language, pluginConfig)

      // Optional Claude fallback for semantic issues
      if (pluginConfig.enableAiFallback && pluginConfig.anthropicApiKey) {
        const claudeIssues = await checkWithClaude(textToCheck, language, pluginConfig.anthropicApiKey)
        issues = [...issues, ...claudeIssues]
      }

      // Filter false positives (async — loads dynamic dictionary from DB)
      issues = await filterFalsePositives(issues, pluginConfig, req.payload)

      // Load existing result to get ignoredIssues (persistent ignore)
      let ignoredIssues: Array<{ ruleId: string; original: string }> = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let existingDoc: any = null
      if (id && collection) {
        try {
          const existing = await req.payload.find({
            collection: 'spellcheck-results',
            where: {
              docId: { equals: String(id) },
              collection: { equals: collection },
            },
            limit: 1,
            overrideAccess: true,
          })
          if (existing.docs.length > 0) {
            existingDoc = existing.docs[0]
            ignoredIssues = Array.isArray(existingDoc.ignoredIssues) ? existingDoc.ignoredIssues : []
          }
        } catch { /* ignore */ }
      }

      // Filter out user-ignored issues
      if (ignoredIssues.length > 0) {
        issues = issues.filter((issue) =>
          !ignoredIssues.some((ignored) => ignored.ruleId === issue.ruleId && ignored.original === issue.original),
        )
      }

      const score = calculateScore(wordCount, issues.length)

      // Store result if we have a doc ID
      if (id && collection) {
        const docIdStr = String(id)
        try {
          // Get doc title/slug from the already-fetched document
          const title = fetchedDoc?.title as string || ''
          const slug = fetchedDoc?.slug as string || ''

          const resultData = {
            docId: docIdStr,
            collection,
            title,
            slug,
            score,
            issueCount: issues.length,
            wordCount,
            issues: issues as unknown as Record<string, unknown>[],
            ignoredIssues: ignoredIssues as unknown as Record<string, unknown>[],
            lastChecked: new Date().toISOString(),
          }

          if (existingDoc) {
            await req.payload.update({
              collection: 'spellcheck-results',
              id: existingDoc.id,
              data: resultData,
              overrideAccess: true,
            })
          } else {
            await req.payload.create({
              collection: 'spellcheck-results',
              data: resultData,
              overrideAccess: true,
            })
          }
        } catch (err) {
          console.error('[spellcheck] Failed to store result:', err)
        }
      }

      const result: SpellCheckResult = {
        docId: id ? String(id) : '',
        collection: collection || '',
        score,
        issueCount: issues.length,
        wordCount,
        issues,
        lastChecked: new Date().toISOString(),
      }

      return Response.json(result)
    } catch (error) {
      console.error('[spellcheck/validate] Error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
