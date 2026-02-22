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
 * Returns the number of replacements made.
 */
function applyFixToLexical(
  node: LexicalNode | LexicalNode[] | null | undefined,
  original: string,
  replacement: string,
): number {
  if (!node) return 0

  if (Array.isArray(node)) {
    let fixed = 0
    for (const item of node) {
      fixed += applyFixToLexical(item, original, replacement)
    }
    return fixed
  }

  if (typeof node !== 'object') return 0

  let fixed = 0

  // Replace in text nodes
  if (node.type === 'text' && typeof node.text === 'string') {
    if (node.text.includes(original)) {
      node.text = node.text.replace(original, replacement)
      fixed++
    }
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      fixed += applyFixToLexical(child, original, replacement)
    }
  }

  // Handle root node
  if (node.root) {
    fixed += applyFixToLexical(node.root, original, replacement)
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

      // Fix in content field
      if (docAny[contentField]) {
        const content = JSON.parse(JSON.stringify(docAny[contentField]))
        const fixed = applyFixToLexical(content, original, replacement)
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

      // Fix in hero richText
      if (docAny.hero?.richText) {
        const hero = JSON.parse(JSON.stringify(docAny.hero))
        const fixed = applyFixToLexical(hero.richText, original, replacement)
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

      // Fix in layout blocks
      if (Array.isArray(docAny.layout)) {
        const layout = JSON.parse(JSON.stringify(docAny.layout))
        let layoutFixed = 0
        for (const block of layout) {
          if (block.richText) {
            layoutFixed += applyFixToLexical(block, original, replacement)
          }
          if (Array.isArray(block.columns)) {
            for (const col of block.columns) {
              if (col.richText) {
                layoutFixed += applyFixToLexical(col, original, replacement)
              }
            }
          }
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
