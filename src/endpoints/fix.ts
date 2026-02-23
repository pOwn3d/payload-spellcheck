/**
 * Fix endpoint — apply a spelling correction at a precise offset in the document.
 *
 * POST /api/spellcheck/fix
 * Body: { id, collection, original, replacement, offset?, length?, field? }
 *
 * v0.8.0: offset-based targeting. Uses the LanguageTool offset to locate the
 * exact text node and position. Falls back to substring search if offset is missing.
 */

import type { PayloadHandler } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { extractTextFromLexical, extractAllTextFromDoc } from '../engine/lexicalParser.js'

interface LexicalNode {
  type?: string
  text?: string
  children?: LexicalNode[]
  root?: LexicalNode
  [key: string]: unknown
}

const SKIP_TYPES = new Set(['code', 'code-block', 'codeBlock'])

// ─── Text extraction helpers (mirror lexicalParser.ts) ──────────────────

function isLexicalJson(value: unknown): value is LexicalNode {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Boolean(
    (obj.root && typeof obj.root === 'object') ||
    (Array.isArray(obj.children) && obj.type !== undefined),
  )
}

// ─── Offset-based Lexical tree fix ──────────────────────────────────────

/**
 * Walk a Lexical tree in the exact same order as extractRecursive (lexicalParser.ts).
 * Count characters to find the text node at `targetOffset`, then apply the fix.
 *
 * Returns { fixed: boolean, chars: number } where `chars` is how many characters
 * this node contributes to the extracted text (same as extractRecursive output length).
 */
function fixInLexicalTree(
  node: LexicalNode | LexicalNode[] | null | undefined,
  targetOffset: number,
  targetLength: number,
  replacement: string,
  currentPos: number,
  depth = 0,
  maxDepth = 50,
): { fixed: boolean; chars: number } {
  if (!node || depth > maxDepth) return { fixed: false, chars: 0 }

  // Arrays
  if (Array.isArray(node)) {
    let chars = 0
    for (const item of node) {
      const r = fixInLexicalTree(item, targetOffset, targetLength, replacement, currentPos + chars, depth + 1, maxDepth)
      chars += r.chars
      if (r.fixed) return { fixed: true, chars }
    }
    return { fixed: false, chars }
  }

  if (typeof node !== 'object') return { fixed: false, chars: 0 }

  // Skip code blocks (same as extractRecursive)
  if (node.type && SKIP_TYPES.has(node.type)) return { fixed: false, chars: 0 }

  // Text node — check if target falls within this node's text
  if (node.type === 'text' && typeof node.text === 'string') {
    const nodeStart = currentPos
    const nodeEnd = currentPos + node.text.length

    if (targetOffset >= nodeStart && targetOffset < nodeEnd) {
      const posInNode = targetOffset - nodeStart
      // Apply fix at the exact position
      node.text = node.text.slice(0, posInNode) + replacement + node.text.slice(posInNode + targetLength)
      return { fixed: true, chars: node.text.length }
    }

    return { fixed: false, chars: node.text.length }
  }

  // Block elements: paragraph, heading, listitem → children + '\n' (early return)
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listitem') {
    let chars = 0
    for (const child of node.children || []) {
      const r = fixInLexicalTree(child, targetOffset, targetLength, replacement, currentPos + chars, depth + 1, maxDepth)
      chars += r.chars
      if (r.fixed) return { fixed: true, chars: chars + 1 }
    }
    chars += 1 // \n after block element
    return { fixed: false, chars }
  }

  // Other nodes (link, mark, etc.) — pass through to children
  let chars = 0
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const r = fixInLexicalTree(child, targetOffset, targetLength, replacement, currentPos + chars, depth + 1, maxDepth)
      chars += r.chars
      if (r.fixed) return { fixed: true, chars }
    }
  }

  // Root node
  if (node.root) {
    const r = fixInLexicalTree(node.root, targetOffset, targetLength, replacement, currentPos + chars, depth + 1, maxDepth)
    chars += r.chars
    if (r.fixed) return { fixed: true, chars }
  }

  return { fixed: false, chars }
}

// ─── Document text entry collection (mirrors extractAllTextFromDoc) ─────

interface TextEntry {
  text: string
  source:
    | { type: 'title' }
    | { type: 'lexical'; data: LexicalNode; topField: string }
    | { type: 'plain'; parent: Record<string, unknown>; key: string; topField: string }
}

const SKIP_KEYS = new Set([
  'id', '_order', '_parent_id', '_path', '_locale', '_uuid',
  'blockType', 'blockName', 'icon', 'color', 'link', 'link_url',
  'enable_link', 'image', 'media', 'form', 'form_id', 'rating',
  'size', 'position', 'relationTo', 'value', 'updatedAt', 'createdAt',
  '_status', 'slug', 'meta', 'publishedAt', 'populatedAuthors',
])

const PLAIN_TEXT_KEYS = new Set([
  'title', 'description', 'heading', 'subheading', 'subtitle',
  'quote', 'author', 'role', 'label', 'link_label', 'block_name',
  'caption', 'alt', 'text', 'summary', 'excerpt',
])

/**
 * Collect text entries from a block (mirrors extractTextFromBlock from lexicalParser.ts).
 * Instead of pushing strings, pushes TextEntry objects with source info.
 */
function collectBlockEntries(
  obj: unknown,
  entries: TextEntry[],
  visited: WeakSet<object>,
  depth = 0,
): void {
  if (!obj || typeof obj !== 'object' || depth > 10) return
  if (visited.has(obj as object)) return
  visited.add(obj as object)

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectBlockEntries(item, entries, visited, depth + 1)
    }
    return
  }

  const record = obj as Record<string, unknown>

  for (const [key, value] of Object.entries(record)) {
    if (SKIP_KEYS.has(key)) continue

    // Lexical JSON field
    if (isLexicalJson(value)) {
      const text = extractTextFromLexical(value)
      if (text) {
        entries.push({
          text,
          source: { type: 'lexical', data: value as LexicalNode, topField: 'layout' },
        })
      }
      continue
    }

    // Plain text fields
    if (typeof value === 'string' && value.length > 2 && value.length < 5000) {
      if (/^(https?:|\/|#|\d{4}-\d{2}|[0-9a-f-]{36}|data:|mailto:)/i.test(value)) continue
      if (/^\{.*\}$/.test(value) || /^\[.*\]$/.test(value)) continue
      if (PLAIN_TEXT_KEYS.has(key)) {
        entries.push({
          text: value,
          source: { type: 'plain', parent: record, key, topField: 'layout' },
        })
      }
    }

    // Recurse into nested objects/arrays
    if (typeof value === 'object' && value !== null) {
      collectBlockEntries(value, entries, visited, depth + 1)
    }
  }
}

/**
 * Build text entries from the entire document, in the same order as extractAllTextFromDoc.
 * Returns entries + deep-cloned doc (mutations go to the clone).
 */
function buildDocumentEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  contentField: string,
): { entries: TextEntry[]; docClone: Record<string, unknown> } {
  const docClone = JSON.parse(JSON.stringify(doc))
  const entries: TextEntry[] = []

  // 1. Title (plain text)
  if (docClone.title && typeof docClone.title === 'string') {
    entries.push({ text: docClone.title, source: { type: 'title' } })
  }

  // 2. Hero richText
  if (docClone.hero?.richText) {
    const text = extractTextFromLexical(docClone.hero.richText)
    if (text) {
      entries.push({
        text,
        source: { type: 'lexical', data: docClone.hero.richText, topField: 'hero' },
      })
    }
  }

  // 3. Content field
  if (docClone[contentField] && isLexicalJson(docClone[contentField])) {
    const text = extractTextFromLexical(docClone[contentField])
    if (text) {
      entries.push({
        text,
        source: { type: 'lexical', data: docClone[contentField], topField: contentField },
      })
    }
  }

  // 4. Layout blocks
  if (Array.isArray(docClone.layout)) {
    const visited = new WeakSet<object>()
    for (const block of docClone.layout) {
      collectBlockEntries(block, entries, visited)
    }
  }

  return { entries, docClone }
}

// ─── Fix application ────────────────────────────────────────────────────

interface OffsetRange {
  startOffset: number
  endOffset: number
  entry: TextEntry
}

/**
 * Apply a fix at a specific offset in the document.
 * Returns the top-level field that was modified (for saving).
 */
function applyFixAtOffset(
  entries: TextEntry[],
  targetOffset: number,
  targetLength: number,
  original: string,
  replacement: string,
): { fixed: boolean; modifiedField: string | null } {
  // Build offset ranges (entries joined by '\n')
  const ranges: OffsetRange[] = []
  let pos = 0
  for (const entry of entries) {
    if (!entry.text) continue
    ranges.push({
      startOffset: pos,
      endOffset: pos + entry.text.length,
      entry,
    })
    pos += entry.text.length + 1 // +1 for '\n' separator
  }

  // Find the range containing the target offset
  for (const range of ranges) {
    if (targetOffset >= range.startOffset && targetOffset < range.endOffset) {
      const localOffset = targetOffset - range.startOffset
      const { entry } = range

      // Verify the text at this position matches `original`
      const actualText = entry.text.slice(localOffset, localOffset + targetLength)
      if (actualText !== original) {
        console.warn(
          `[spellcheck/fix] Text mismatch at offset ${targetOffset}: expected "${original}", found "${actualText}"`,
        )
        // Try to find `original` nearby (within ±20 chars) for slight offset drift
        const searchStart = Math.max(0, localOffset - 20)
        const searchEnd = Math.min(entry.text.length, localOffset + 20)
        const nearby = entry.text.slice(searchStart, searchEnd)
        const nearbyIdx = nearby.indexOf(original)
        if (nearbyIdx === -1) {
          return { fixed: false, modifiedField: null }
        }
        // Adjust localOffset to the nearby match
        const adjustedLocal = searchStart + nearbyIdx
        return applyFixToEntry(entry, adjustedLocal, targetLength, replacement)
      }

      return applyFixToEntry(entry, localOffset, targetLength, replacement)
    }
  }

  return { fixed: false, modifiedField: null }
}

function applyFixToEntry(
  entry: TextEntry,
  localOffset: number,
  targetLength: number,
  replacement: string,
): { fixed: boolean; modifiedField: string } {
  const { source } = entry

  switch (source.type) {
    case 'title': {
      // Can't directly mutate title from here — we need docClone access.
      // Title entries store text from docClone.title, but we can't splice it here.
      // Instead, mark it and let the caller handle it.
      return { fixed: true, modifiedField: '__title__' }
    }
    case 'lexical': {
      const r = fixInLexicalTree(source.data, localOffset, targetLength, replacement, 0)
      if (r.fixed) {
        return { fixed: true, modifiedField: source.topField }
      }
      return { fixed: false, modifiedField: null }
    }
    case 'plain': {
      const currentVal = source.parent[source.key] as string
      source.parent[source.key] = currentVal.slice(0, localOffset) + replacement + currentVal.slice(localOffset + targetLength)
      return { fixed: true, modifiedField: source.topField }
    }
  }
}

// ─── Legacy fallback: substring-based fix (v0.7.0 behavior) ────────────

function legacyFixSubstring(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docClone: any,
  original: string,
  replacement: string,
  contentField: string,
): { fixed: boolean; modifiedField: string | null } {
  // Check hero richText
  if (docClone.hero?.richText) {
    const state = { done: false }
    const fixed = legacyApplyToLexical(docClone.hero.richText, original, replacement, state)
    if (fixed) return { fixed: true, modifiedField: 'hero' }
  }

  // Check content
  if (docClone[contentField]) {
    const state = { done: false }
    const fixed = legacyApplyToLexical(docClone[contentField], original, replacement, state)
    if (fixed) return { fixed: true, modifiedField: contentField }
  }

  // Check layout blocks
  if (Array.isArray(docClone.layout)) {
    for (const block of docClone.layout) {
      const state = { done: false }
      const fixed = legacyApplyInObject(block, original, replacement, state)
      if (fixed) return { fixed: true, modifiedField: 'layout' }
    }
  }

  return { fixed: false, modifiedField: null }
}

function legacyApplyToLexical(
  node: LexicalNode | LexicalNode[] | null | undefined,
  original: string,
  replacement: string,
  state: { done: boolean },
): boolean {
  if (!node || state.done) return false

  if (Array.isArray(node)) {
    for (const item of node) {
      if (state.done) break
      if (legacyApplyToLexical(item, original, replacement, state)) return true
    }
    return false
  }

  if (typeof node !== 'object') return false

  if (node.type === 'text' && typeof node.text === 'string') {
    if (!state.done && node.text.includes(original)) {
      node.text = node.text.replace(original, replacement)
      state.done = true
      return true
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (state.done) break
      if (legacyApplyToLexical(child, original, replacement, state)) return true
    }
  }

  if (node.root && !state.done) {
    if (legacyApplyToLexical(node.root, original, replacement, state)) return true
  }

  return false
}

function legacyApplyInObject(
  obj: unknown,
  original: string,
  replacement: string,
  state: { done: boolean },
  depth = 0,
): boolean {
  if (!obj || typeof obj !== 'object' || state.done || depth > 10) return false

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (state.done) break
      if (legacyApplyInObject(item, original, replacement, state, depth + 1)) return true
    }
    return false
  }

  const record = obj as Record<string, unknown>

  for (const [key, value] of Object.entries(record)) {
    if (state.done) break

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>
      if (v.root && typeof v.root === 'object') {
        if (legacyApplyToLexical(value as LexicalNode, original, replacement, state)) return true
        continue
      }
    }

    if (typeof value === 'string' && value.includes(original)) {
      if (PLAIN_TEXT_KEYS.has(key)) {
        record[key] = value.replace(original, replacement)
        state.done = true
        return true
      }
    }

    if (typeof value === 'object' && value !== null) {
      if (legacyApplyInObject(value, original, replacement, state, depth + 1)) return true
    }
  }

  return false
}

// ─── Handler ────────────────────────────────────────────────────────────

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
      const { id, collection, original, replacement, offset, length, field } = body as {
        id: string | number
        collection: string
        original: string
        replacement: string
        offset?: number
        length?: number
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

      // Build entries + deep clone
      const { entries, docClone } = buildDocumentEntries(doc, contentField)

      let result: { fixed: boolean; modifiedField: string | null }

      if (typeof offset === 'number' && typeof length === 'number') {
        // v0.8.0: offset-based targeting (precise)
        result = applyFixAtOffset(entries, offset, length, original, replacement)

        // Handle title fix (special case — needs direct docClone mutation)
        if (result.modifiedField === '__title__') {
          const titleEntry = entries.find((e) => e.source.type === 'title')
          if (titleEntry) {
            // Recalculate localOffset for title
            const localOffset = offset // title is always at position 0
            docClone.title = (docClone.title as string).slice(0, localOffset)
              + replacement
              + (docClone.title as string).slice(localOffset + length)
          }
          result.modifiedField = 'title'
        }

        // If offset-based fix failed, fall back to legacy
        if (!result.fixed) {
          console.warn('[spellcheck/fix] Offset-based fix failed, trying legacy substring search')
          result = legacyFixSubstring(docClone, original, replacement, contentField)
        }
      } else {
        // Legacy: substring-based (for backwards compatibility)
        result = legacyFixSubstring(docClone, original, replacement, contentField)
      }

      if (!result.fixed || !result.modifiedField) {
        return Response.json({
          success: false,
          fixesApplied: 0,
          error: 'Could not locate the text to fix',
          original,
          replacement,
        })
      }

      // Save only the modified field
      const updateData: Record<string, unknown> = {}

      switch (result.modifiedField) {
        case 'title':
          updateData.title = docClone.title
          break
        case 'hero':
          updateData.hero = docClone.hero
          break
        case 'layout':
          updateData.layout = docClone.layout
          break
        default:
          // Content field or other
          updateData[result.modifiedField] = docClone[result.modifiedField]
          break
      }

      await req.payload.update({
        collection,
        id,
        data: updateData,
        overrideAccess: true,
      })

      return Response.json({
        success: true,
        fixesApplied: 1,
        original,
        replacement,
        method: typeof offset === 'number' ? 'offset' : 'legacy',
      })
    } catch (error) {
      console.error('[spellcheck/fix] Error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
