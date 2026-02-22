/**
 * Fix endpoint — apply a spelling correction in the Lexical JSON.
 * POST /api/spellcheck/fix
 * Body: { id, collection, original, replacement, field? }
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'

interface LexicalNode {
  type?: string
  text?: string
  children?: LexicalNode[]
  root?: LexicalNode
  [key: string]: unknown
}

/**
 * Recursively replace text in Lexical JSON nodes.
 * Only replaces the FIRST occurrence found, then stops.
 * Uses `state` object to track whether a fix was already applied.
 */
function applyFixToLexical(
  node: LexicalNode | LexicalNode[] | null | undefined,
  original: string,
  replacement: string,
  state = { done: false },
): number {
  if (!node || state.done) return 0

  if (Array.isArray(node)) {
    let fixed = 0
    for (const item of node) {
      if (state.done) break
      fixed += applyFixToLexical(item, original, replacement, state)
    }
    return fixed
  }

  if (typeof node !== 'object') return 0

  // Replace in text nodes — ONLY the first match
  if (node.type === 'text' && typeof node.text === 'string') {
    if (!state.done && node.text.includes(original)) {
      node.text = node.text.replace(original, replacement)
      state.done = true
      return 1
    }
  }

  let fixed = 0

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (state.done) break
      fixed += applyFixToLexical(child, original, replacement, state)
    }
  }

  // Handle root node
  if (node.root && !state.done) {
    fixed += applyFixToLexical(node.root, original, replacement, state)
  }

  return fixed
}

/**
 * Recursively search and fix text in any object structure (blocks with nested richText/text fields).
 * Fixes only in Lexical richText nodes. For plain text fields, replaces directly.
 */
function applyFixInObject(
  obj: unknown,
  original: string,
  replacement: string,
  state: { done: boolean },
  depth = 0,
): number {
  if (!obj || typeof obj !== 'object' || state.done || depth > 10) return 0

  let fixed = 0

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (state.done) break
      fixed += applyFixInObject(item, original, replacement, state, depth + 1)
    }
    return fixed
  }

  const record = obj as Record<string, unknown>

  for (const [key, value] of Object.entries(record)) {
    if (state.done) break

    // Lexical JSON field (has root.children)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>
      if (v.root && typeof v.root === 'object') {
        fixed += applyFixToLexical(value as LexicalNode, original, replacement, state)
        continue
      }
    }

    // Plain text fields (title, description, heading, quote, etc.)
    if (typeof value === 'string' && value.includes(original)) {
      if (['title', 'description', 'heading', 'subheading', 'quote', 'label', 'caption', 'text', 'summary'].includes(key)) {
        record[key] = value.replace(original, replacement)
        state.done = true
        fixed++
        break
      }
    }

    // Recurse into nested objects/arrays
    if (typeof value === 'object' && value !== null) {
      fixed += applyFixInObject(value, original, replacement, state, depth + 1)
    }
  }

  return fixed
}

export function createFixHandler(
  pluginConfig: SpellCheckPluginConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!req.user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await (req as any).json()
      const { id, collection, original, replacement, field } = body as {
        id: string | number
        collection: string
        original: string
        replacement: string
        field?: string
      }

      if (!id || !collection || !original || replacement === undefined) {
        return Response.json(
          { error: 'Missing required fields: id, collection, original, replacement' },
          { status: 400 },
        )
      }

      const contentField = field || pluginConfig.contentField || 'content'

      // Fetch the document
      const doc = await req.payload.findByID({
        collection,
        id,
        depth: 0,
        overrideAccess: true,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docAny = doc as any
      let totalFixed = 0

      // Shared state to stop after first fix across all fields
      const fixState = { done: false }

      // Fix in hero richText (check first since hero text appears first)
      if (!fixState.done && docAny.hero?.richText) {
        const hero = JSON.parse(JSON.stringify(docAny.hero))
        const fixed = applyFixToLexical(hero.richText, original, replacement, fixState)
        if (fixed > 0) {
          totalFixed += fixed
          await req.payload.update({
            collection,
            id,
            data: { hero },
            overrideAccess: true,
          })
        }
      }

      // Fix in content field
      if (!fixState.done && docAny[contentField]) {
        const content = JSON.parse(JSON.stringify(docAny[contentField]))
        const fixed = applyFixToLexical(content, original, replacement, fixState)
        if (fixed > 0) {
          totalFixed += fixed
          await req.payload.update({
            collection,
            id,
            data: { [contentField]: content },
            overrideAccess: true,
          })
        }
      }

      // Fix in layout blocks
      if (!fixState.done && Array.isArray(docAny.layout)) {
        const layout = JSON.parse(JSON.stringify(docAny.layout))
        let layoutFixed = 0
        for (const block of layout) {
          if (fixState.done) break
          // Fix in any richText/rich_text field within the block
          layoutFixed += applyFixInObject(block, original, replacement, fixState)
        }
        if (layoutFixed > 0) {
          totalFixed += layoutFixed
          await req.payload.update({
            collection,
            id,
            data: { layout },
            overrideAccess: true,
          })
        }
      }

      return Response.json({
        success: true,
        fixesApplied: totalFixed,
        original,
        replacement,
      })
    } catch (error) {
      console.error('[spellcheck/fix] Error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
