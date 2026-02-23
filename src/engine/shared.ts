/**
 * Shared types and constants for Lexical text extraction.
 * Used by both lexicalParser.ts (scan) and fix.ts (correction)
 * to ensure identical traversal behavior.
 */

export interface LexicalNode {
  type?: string
  text?: string
  children?: LexicalNode[]
  root?: LexicalNode
  tag?: string
  [key: string]: unknown
}

/** Node types to skip (their text content is not natural language) */
export const SKIP_TYPES = new Set(['code', 'code-block', 'codeBlock'])

/**
 * Check if a value looks like a Lexical JSON structure (has root.children).
 */
export function isLexicalJson(value: unknown): value is LexicalNode {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Boolean(
    (obj.root && typeof obj.root === 'object') ||
    (Array.isArray(obj.children) && obj.type !== undefined),
  )
}

/** Keys to skip when traversing document blocks (non-content fields) */
export const SKIP_KEYS = new Set([
  'id', '_order', '_parent_id', '_path', '_locale', '_uuid',
  'blockType', 'blockName', 'icon', 'color', 'link', 'link_url',
  'enable_link', 'image', 'media', 'form', 'form_id', 'rating',
  'size', 'position', 'relationTo', 'value', 'updatedAt', 'createdAt',
  '_status', 'slug', 'meta', 'publishedAt', 'populatedAuthors',
])

/** Keys that contain plain-text content worth checking */
export const PLAIN_TEXT_KEYS = new Set([
  'title', 'description', 'heading', 'subheading', 'subtitle',
  'quote', 'author', 'role', 'label', 'link_label', 'block_name',
  'caption', 'alt', 'text', 'summary', 'excerpt',
])
