/**
 * Core fix logic — extracted for reuse by both fix.ts and fixAll.ts.
 * Applies a spelling correction to a document at a given offset.
 */

import type { Payload } from 'payload'
import type { SpellCheckPluginConfig } from '../types.js'
import { extractAllTextFromDocWithSources, type TextSegment } from '../engine/lexicalParser.js'
import { type LexicalNode, SKIP_TYPES, PLAIN_TEXT_KEYS } from '../engine/shared.js'

// ─── Offset-based Lexical tree fix ──────────────────────────────────────

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

  if (node.type && SKIP_TYPES.has(node.type)) return { fixed: false, chars: 0 }

  if (node.type === 'text' && typeof node.text === 'string') {
    const nodeStart = currentPos
    const nodeEnd = currentPos + node.text.length

    if (targetOffset >= nodeStart && targetOffset < nodeEnd) {
      const posInNode = targetOffset - nodeStart
      node.text = node.text.slice(0, posInNode) + replacement + node.text.slice(posInNode + targetLength)
      return { fixed: true, chars: node.text.length }
    }

    return { fixed: false, chars: node.text.length }
  }

  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listitem') {
    let chars = 0
    for (const child of node.children || []) {
      const r = fixInLexicalTree(child, targetOffset, targetLength, replacement, currentPos + chars, depth + 1, maxDepth)
      chars += r.chars
      if (r.fixed) return { fixed: true, chars: chars + 1 }
    }
    chars += 1
    return { fixed: false, chars }
  }

  let chars = 0
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const r = fixInLexicalTree(child, targetOffset, targetLength, replacement, currentPos + chars, depth + 1, maxDepth)
      chars += r.chars
      if (r.fixed) return { fixed: true, chars }
    }
  }

  if (node.root) {
    const r = fixInLexicalTree(node.root, targetOffset, targetLength, replacement, currentPos + chars, depth + 1, maxDepth)
    chars += r.chars
    if (r.fixed) return { fixed: true, chars }
  }

  return { fixed: false, chars }
}

// ─── Offset-based fix using unified extraction ──────────────────────────

function applyFixAtOffset(
  segments: TextSegment[],
  fullText: string,
  targetOffset: number,
  targetLength: number,
  replacement: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docClone: any,
): { fixed: boolean; modifiedField: string | null } {
  const rawJoined = segments.map((s) => s.text).join('\n')
  const trimOffset = rawJoined.length - rawJoined.trimStart().length
  const rawTargetOffset = targetOffset + trimOffset

  let pos = 0
  for (const segment of segments) {
    const segEnd = pos + segment.text.length
    if (rawTargetOffset >= pos && rawTargetOffset < segEnd) {
      const localOffset = rawTargetOffset - pos
      return applyFixToSegment(segment, localOffset, targetLength, replacement, docClone)
    }
    pos = segEnd + 1
  }

  return { fixed: false, modifiedField: null }
}

function applyFixToSegment(
  segment: TextSegment,
  localOffset: number,
  targetLength: number,
  replacement: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docClone: any,
): { fixed: boolean; modifiedField: string | null } {
  const { source } = segment

  switch (source.type) {
    case 'title': {
      const title = docClone.title as string
      docClone.title = title.slice(0, localOffset) + replacement + title.slice(localOffset + targetLength)
      return { fixed: true, modifiedField: 'title' }
    }
    case 'lexical': {
      const r = fixInLexicalTree(source.data, localOffset, targetLength, replacement, 0)
      return r.fixed
        ? { fixed: true, modifiedField: source.topField }
        : { fixed: false, modifiedField: null }
    }
    case 'plain': {
      const currentVal = source.parent[source.key] as string
      source.parent[source.key] = currentVal.slice(0, localOffset) + replacement + currentVal.slice(localOffset + targetLength)
      return { fixed: true, modifiedField: source.topField }
    }
  }
}

// ─── Legacy fallback ────────────────────────────────────────────────────

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

function legacyFixSubstring(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docClone: any,
  original: string,
  replacement: string,
  contentField: string,
): { fixed: boolean; modifiedField: string | null } {
  if (typeof docClone.title === 'string' && docClone.title.includes(original)) {
    docClone.title = docClone.title.replace(original, replacement)
    return { fixed: true, modifiedField: 'title' }
  }

  if (docClone.hero?.richText) {
    const state = { done: false }
    const fixed = legacyApplyToLexical(docClone.hero.richText, original, replacement, state)
    if (fixed) return { fixed: true, modifiedField: 'hero' }
  }

  if (docClone[contentField]) {
    const state = { done: false }
    const fixed = legacyApplyToLexical(docClone[contentField], original, replacement, state)
    if (fixed) return { fixed: true, modifiedField: contentField }
  }

  if (Array.isArray(docClone.layout)) {
    for (const block of docClone.layout) {
      const state = { done: false }
      const fixed = legacyApplyInObject(block, original, replacement, state)
      if (fixed) return { fixed: true, modifiedField: 'layout' }
    }
  }

  return { fixed: false, modifiedField: null }
}

// ─── Search-based offset correction ─────────────────────────────────────

function findClosestMatch(text: string, needle: string, expectedOffset: number): number {
  if (!needle) return -1

  const occurrences: number[] = []
  let idx = text.indexOf(needle)
  while (idx !== -1) {
    occurrences.push(idx)
    idx = text.indexOf(needle, idx + 1)
  }

  if (occurrences.length === 0) return -1
  if (occurrences.length === 1) return occurrences[0]

  return occurrences.reduce((closest, curr) =>
    Math.abs(curr - expectedOffset) < Math.abs(closest - expectedOffset) ? curr : closest,
  )
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface FixParams {
  id: string | number
  collection: string
  original: string
  replacement: string
  offset?: number
  length?: number
  field?: string
}

export interface FixResult {
  success: boolean
  fixesApplied: number
  original: string
  replacement: string
  method?: string
  error?: string
}

/**
 * Apply a single fix to a document. Core logic used by both fix and fixAll endpoints.
 * Fetches the document, applies the fix, and saves it.
 */
export async function applyFix(
  payload: Payload,
  params: FixParams,
  pluginConfig: SpellCheckPluginConfig,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<FixResult> {
  const { id, collection, original, replacement, offset, length, field } = params
  const contentField = field || pluginConfig.contentField || 'content'

  const findResult = await payload.find({
    collection,
    where: { id: { equals: id } },
    limit: 1,
    depth: 0,
    draft: true,
    overrideAccess: true,
  })

  if (!findResult.docs.length) {
    return { success: false, fixesApplied: 0, original, replacement, error: 'Document not found' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = findResult.docs[0] as any
  const { fullText, segments } = extractAllTextFromDocWithSources(doc, contentField)

  let result: { fixed: boolean; modifiedField: string | null }
  let method = 'legacy'

  if (typeof offset === 'number' && typeof length === 'number') {
    const actual = fullText.slice(offset, offset + length)

    if (actual === original) {
      result = applyFixAtOffset(segments, fullText, offset, length, replacement, doc)
      method = 'offset'
    } else {
      const foundOffset = findClosestMatch(fullText, original, offset)

      if (foundOffset >= 0) {
        logger?.info(
          `[spellcheck/fix] Offset drift corrected: "${original}" at ${foundOffset} (stored: ${offset}, drift: ${foundOffset - offset})`,
        )
        result = applyFixAtOffset(segments, fullText, foundOffset, original.length, replacement, doc)
        method = 'search'
      } else {
        logger?.warn(
          `[spellcheck/fix] "${original}" not found in extracted text (${fullText.length} chars)`,
        )
        result = { fixed: false, modifiedField: null }
      }
    }

    if (!result.fixed) {
      result = legacyFixSubstring(doc, original, replacement, contentField)
      if (result.fixed) method = 'legacy'
    }
  } else {
    result = legacyFixSubstring(doc, original, replacement, contentField)
  }

  if (!result.fixed || !result.modifiedField) {
    return {
      success: false,
      fixesApplied: 0,
      original,
      replacement,
      error: 'Could not locate the text to fix',
    }
  }

  // Save only the modified field
  const updateData: Record<string, unknown> = {}

  switch (result.modifiedField) {
    case 'title':
      updateData.title = doc.title
      break
    case 'hero':
      updateData.hero = doc.hero
      break
    case 'layout':
      updateData.layout = doc.layout
      break
    default:
      updateData[result.modifiedField] = doc[result.modifiedField]
      break
  }

  await payload.update({
    collection,
    id,
    data: updateData,
    overrideAccess: true,
  })

  return {
    success: true,
    fixesApplied: 1,
    original,
    replacement,
    method,
  }
}
