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

  // Extract text from text nodes
  if (node.type === 'text' && typeof node.text === 'string') {
    text += node.text + ' '
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
 * Count words in extracted text.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length
}
