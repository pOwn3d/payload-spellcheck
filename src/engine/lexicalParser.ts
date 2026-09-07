/**
 * Extract plain text from Lexical JSON nodes.
 * Recursively traverses the Lexical AST, extracting text nodes
 * and skipping code blocks.
 *
 * v0.9.8: Single source of truth for text extraction.
 * extractAllTextFromDocWithSources() returns both the text AND source
 * references, used by scan (validate/bulk) and fix endpoints.
 * This eliminates offset divergence between scan and fix.
 */

import { type LexicalNode, SKIP_TYPES, SKIP_KEYS, PLAIN_TEXT_KEYS, isLexicalJson } from './shared.js'

// ─── Types ──────────────────────────────────────────────────────────────

export interface TextSegment {
  /** Segment text as it appears in `fullText` (Lexical segments are trimmed) */
  text: string
  /**
   * Number of characters trimmed off the FRONT of the raw extraction to produce
   * `text`. Lexical extraction emits a newline after every block, so a leading
   * empty paragraph (or any leading whitespace) shifts every offset inside the
   * tree by this much. The fix path walks the RAW tree, so it must add this back
   * to a `text`-relative offset — otherwise the correction lands one or more
   * characters early and silently mangles the content.
   * Always 0 for `title` and `plain` segments (their text is used verbatim).
   */
  leadingTrim: number
  source:
    | { type: 'title' }
    | { type: 'lexical'; data: LexicalNode; topField: string }
    | { type: 'plain'; parent: Record<string, unknown>; key: string; topField: string }
}

export interface ExtractedDoc {
  /** Full text sent to LanguageTool (segments joined by \n, trimmed) */
  fullText: string
  /** Individual text segments with source references (for fix mutation) */
  segments: TextSegment[]
}

// ─── Unified extraction ─────────────────────────────────────────────────

/**
 * Extract all text from a document with source tracking.
 * Single source of truth — used by scan (validate/bulk) and fix endpoints.
 */
export function extractAllTextFromDocWithSources(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  contentField = 'content',
): ExtractedDoc {
  const rawSegments: TextSegment[] = []
  const visited = new WeakSet<object>()

  // 1. Title
  if (doc.title && typeof doc.title === 'string') {
    rawSegments.push({ text: doc.title, leadingTrim: 0, source: { type: 'title' } })
  }

  // 2. Hero richText
  if (doc.hero?.richText) {
    rawSegments.push(buildLexicalSegment(doc.hero.richText, 'hero'))
  }

  // 3. Content field
  if (doc[contentField] && isLexicalJson(doc[contentField])) {
    rawSegments.push(buildLexicalSegment(doc[contentField], contentField))
  }

  // 4. Layout blocks
  if (Array.isArray(doc.layout)) {
    for (const block of doc.layout) {
      extractBlockSegments(block, rawSegments, visited, 'layout')
    }
  }

  // Filter empty segments + build fullText (identical logic for scan and fix)
  const segments = rawSegments.filter((s) => Boolean(s.text))
  const fullText = segments.map((s) => s.text).join('\n').trim()

  return { fullText, segments }
}

/**
 * Build a Lexical text segment, recording how much leading whitespace the trim
 * removed so the fix path can translate offsets back to raw tree coordinates.
 */
function buildLexicalSegment(value: unknown, topField: string): TextSegment {
  const raw = extractTextFromLexicalRaw(value)
  return {
    text: raw.trim(),
    leadingTrim: raw.length - raw.trimStart().length,
    source: { type: 'lexical', data: value as LexicalNode, topField },
  }
}

/**
 * Extract all plain text from a document (convenience wrapper).
 * Delegates to extractAllTextFromDocWithSources for consistency.
 */
export function extractAllTextFromDoc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  contentField = 'content',
): string {
  return extractAllTextFromDocWithSources(doc, contentField).fullText
}

/**
 * Recursively extract text segments from a block structure.
 * Handles richText (Lexical), plain text fields, and nested arrays/objects.
 */
function extractBlockSegments(
  obj: unknown,
  segments: TextSegment[],
  visited: WeakSet<object>,
  topField: string,
  depth = 0,
): void {
  if (!obj || typeof obj !== 'object' || depth > 10) return
  if (visited.has(obj as object)) return
  visited.add(obj as object)

  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractBlockSegments(item, segments, visited, topField, depth + 1)
    }
    return
  }

  const record = obj as Record<string, unknown>

  for (const [key, value] of Object.entries(record)) {
    if (SKIP_KEYS.has(key)) continue

    // Lexical JSON field
    if (isLexicalJson(value)) {
      segments.push(buildLexicalSegment(value, topField))
      continue
    }

    // Plain text fields (title, description, heading, quote, etc.)
    if (typeof value === 'string' && value.length > 2 && value.length < 5000) {
      // Skip things that look like IDs, URLs, dates, or code
      if (/^(https?:|\/|#|\d{4}-\d{2}|[0-9a-f-]{36}|data:|mailto:)/i.test(value)) continue
      if (/^\{.*\}$/.test(value) || /^\[.*\]$/.test(value)) continue
      // Only include fields that look like natural language
      if (PLAIN_TEXT_KEYS.has(key)) {
        segments.push({
          text: value,
          leadingTrim: 0,
          source: { type: 'plain', parent: record, key, topField },
        })
      }
    }

    // Recurse into nested objects/arrays
    if (typeof value === 'object' && value !== null) {
      extractBlockSegments(value, segments, visited, topField, depth + 1)
    }
  }
}

// ─── Lexical extraction ─────────────────────────────────────────────────

/**
 * Extract all plain text from a Lexical JSON structure.
 * Returns a single string with text nodes separated by newlines.
 */
export function extractTextFromLexical(
  node: unknown,
  maxDepth = 50,
): string {
  return extractTextFromLexicalRaw(node, maxDepth).trim()
}

/**
 * Same as extractTextFromLexical but WITHOUT the final trim — these are the
 * coordinates the fix path walks the tree in.
 */
export function extractTextFromLexicalRaw(
  node: unknown,
  maxDepth = 50,
): string {
  return extractRecursive(node as LexicalNode, 0, maxDepth)
}

function extractRecursive(
  node: LexicalNode | LexicalNode[] | null | undefined,
  depth: number,
  maxDepth: number,
): string {
  if (!node || depth > maxDepth) return ''

  // Handle arrays
  if (Array.isArray(node)) {
    let text = ''
    for (const item of node) {
      text += extractRecursive(item, depth + 1, maxDepth)
    }
    return text
  }

  if (typeof node !== 'object') return ''

  // Skip code blocks
  if (node.type && SKIP_TYPES.has(node.type)) return ''

  let text = ''

  // Extract text from text nodes (no extra space — Lexical text nodes already contain spaces)
  if (node.type === 'text' && typeof node.text === 'string') {
    text += node.text
  }

  // Add line breaks after block-level elements
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listitem') {
    // Process children first, then add newline
    for (const child of node.children || []) {
      text += extractRecursive(child, depth + 1, maxDepth)
    }
    text += '\n'
    return text
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      text += extractRecursive(child, depth + 1, maxDepth)
    }
  }

  // Handle root node
  if (node.root) {
    text += extractRecursive(node.root, depth + 1, maxDepth)
  }

  return text
}

// ─── Utilities ──────────────────────────────────────────────────────────

/**
 * Count words in extracted text.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length
}
