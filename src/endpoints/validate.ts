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

      if (rawText) {
        // Direct text check (no doc lookup)
        textToCheck = rawText
      } else if (id && collection) {
        // Fetch doc and extract text
        const doc = await req.payload.findByID({
          collection,
          id,
          depth: 1,
          overrideAccess: true,
        })
        textToCheck = extractAllTextFromDoc(doc, contentField)
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

      // Filter false positives
      issues = filterFalsePositives(issues, pluginConfig)
      const score = calculateScore(wordCount, issues.length)

      // Store result if we have a doc ID
      if (id && collection) {
        const docIdStr = String(id)
        try {
          // Upsert: find existing result for this doc
          const existing = await req.payload.find({
            collection: 'spellcheck-results',
            where: {
              docId: { equals: docIdStr },
              collection: { equals: collection },
            },
            limit: 1,
            overrideAccess: true,
          })

          // Get doc title/slug for dashboard display
          let title = ''
          let slug = ''
          try {
            const doc = await req.payload.findByID({
              collection,
              id,
              depth: 0,
              overrideAccess: true,
            })
            title = (doc as Record<string, unknown>).title as string || ''
            slug = (doc as Record<string, unknown>).slug as string || ''
          } catch { /* ignore */ }

          const resultData = {
            docId: docIdStr,
            collection,
            title,
            slug,
            score,
            issueCount: issues.length,
            wordCount,
            issues: issues as unknown as Record<string, unknown>[],
            lastChecked: new Date().toISOString(),
          }

          if (existing.docs.length > 0) {
            await req.payload.update({
              collection: 'spellcheck-results',
              id: existing.docs[0].id,
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
