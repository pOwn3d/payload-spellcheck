/**
 * Extract plain text from Lexical JSON nodes.
 * Recursively traverses the Lexical AST, extracting text nodes
 * and skipping code blocks.
 */

interface LexicalNode {
  type?: string
  text?: string
  children?: LexicalNode[]
  root?: LexicalNode
  tag?: string
  [key: string]: unknown
}

/** Node types to skip (their text content is not natural language) */
const SKIP_TYPES = new Set(['code', 'code-block', 'codeBlock'])

/**
 * Check if a value looks like a Lexical JSON structure (has root.children).
 */
function isLexicalJson(value: unknown): value is LexicalNode {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Boolean(
    (obj.root && typeof obj.root === 'object') ||
    (Array.isArray(obj.children) && obj.type !== undefined),
  )
}

/**
 * Extract all text from a document object by deeply traversing all properties.
 * Finds all Lexical JSON fields and plain text fields automatically.
 * Returns a single string with all extracted text.
 */
export function extractAllTextFromDoc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  contentField = 'content',
): string {
  const texts: string[] = []
  const visited = new WeakSet<object>()

  // Always extract title first
  if (doc.title && typeof doc.title === 'string') {
    texts.push(doc.title)
  }

  // Extract hero richText
  if (doc.hero?.richText) {
    texts.push(extractTextFromLexical(doc.hero.richText))
  }

  // Extract main content field
  if (doc[contentField] && isLexicalJson(doc[contentField])) {
    texts.push(extractTextFromLexical(doc[contentField]))
  }

  // Deep traverse layout blocks
  if (Array.isArray(doc.layout)) {
    for (const block of doc.layout) {
      extractTextFromBlock(block, texts, visited)
    }
  }

  return stripHtml(texts.filter(Boolean).join('\n').trim())
}

/**
 * Recursively extract text from a block structure.
 * Handles richText (Lexical), plain text fields, and nested arrays/objects.
 */
function extractTextFromBlock(
  obj: unknown,
  texts: string[],
  visited: WeakSet<object>,
  depth = 0,
): void {
  if (!obj || typeof obj !== 'object' || depth > 10) return
  if (visited.has(obj as object)) return
  visited.add(obj as object)

  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractTextFromBlock(item, texts, visited, depth + 1)
    }
    return
  }

  const record = obj as Record<string, unknown>

  // Skip non-content fields
  const skipKeys = new Set([
    'id', '_order', '_parent_id', '_path', '_locale', '_uuid',
    'blockType', 'blockName', 'icon', 'color', 'link', 'link_url',
    'enable_link', 'image', 'media', 'form', 'form_id', 'rating',
    'size', 'position', 'relationTo', 'value', 'updatedAt', 'createdAt',
    '_status', 'slug', 'meta', 'publishedAt', 'populatedAuthors',
  ])

  for (const [key, value] of Object.entries(record)) {
    if (skipKeys.has(key)) continue

    // Lexical JSON field
    if (isLexicalJson(value)) {
      texts.push(extractTextFromLexical(value))
      continue
    }

    // Plain text fields (title, description, heading, quote, etc.)
    if (typeof value === 'string' && value.length > 2 && value.length < 5000) {
      // Skip things that look like IDs, URLs, dates, or code
      if (/^(https?:|\/|#|\d{4}-\d{2}|[0-9a-f-]{36}|data:|mailto:)/i.test(value)) continue
      if (/^\{.*\}$/.test(value) || /^\[.*\]$/.test(value)) continue
      // Only include fields that look like natural language
      if (['title', 'description', 'heading', 'subheading', 'subtitle',
           'quote', 'author', 'role', 'label', 'link_label', 'block_name',
           'caption', 'alt', 'text', 'summary', 'excerpt'].includes(key)) {
        texts.push(value)
      }
    }

    // Recurse into nested objects/arrays
    if (typeof value === 'object' && value !== null) {
      extractTextFromBlock(value, texts, visited, depth + 1)
    }
  }
}

/**
 * Extract all plain text from a Lexical JSON structure.
 * Returns a single string with text nodes separated by spaces.
 */
export function extractTextFromLexical(
  node: unknown,
  maxDepth = 50,
): string {
  return extractRecursive(node as LexicalNode, 0, maxDepth).trim()
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

/**
 * Strip any residual HTML tags from extracted text.
 * Safety measure in case HTML leaks through Lexical or plain text fields.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')  // Remove HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, '')   // Remove remaining HTML entities
    .replace(/\s{2,}/g, ' ')   // Collapse multiple spaces
}

/**
 * Count words in extracted text.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length
}
