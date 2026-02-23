#!/usr/bin/env node
/**
 * Debug script — test text extraction + LanguageTool on a specific page.
 * Usage: node scripts/debug-check.mjs <url-or-slug> [api-base]
 *
 * Examples:
 *   node scripts/debug-check.mjs application-mobile/expo-react-native https://consilioweb.fr
 *   node scripts/debug-check.mjs agence-web-correze https://consilioweb.fr
 *   node scripts/debug-check.mjs agence-web-correze http://localhost:3003
 */

const slug = process.argv[2]
const apiBase = process.argv[3] || 'https://consilioweb.fr'

if (!slug) {
  console.error('Usage: node scripts/debug-check.mjs <slug> [api-base]')
  console.error('  Ex: node scripts/debug-check.mjs agence-web-correze https://consilioweb.fr')
  process.exit(1)
}

const LANGUAGETOOL_API = 'https://api.languagetool.org/v2/check'

// ---- Text extraction (simplified from lexicalParser.ts) ----

function isLexicalJson(value) {
  if (!value || typeof value !== 'object') return false
  return Boolean(
    (value.root && typeof value.root === 'object') ||
    (Array.isArray(value.children) && value.type !== undefined),
  )
}

function extractTextFromLexical(node, maxDepth = 50) {
  return extractRecursive(node, 0, maxDepth).trim()
}

function extractRecursive(node, depth, maxDepth) {
  if (!node || depth > maxDepth) return ''
  if (Array.isArray(node)) return node.map(n => extractRecursive(n, depth + 1, maxDepth)).join('')
  if (typeof node !== 'object') return ''

  const SKIP = new Set(['code', 'code-block', 'codeBlock'])
  if (node.type && SKIP.has(node.type)) return ''

  let text = ''

  if (node.type === 'text' && typeof node.text === 'string') {
    text += node.text // NO extra space — this is the v0.6.0 fix
  }

  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listitem') {
    for (const child of node.children || []) {
      text += extractRecursive(child, depth + 1, maxDepth)
    }
    text += '\n'
    return text
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      text += extractRecursive(child, depth + 1, maxDepth)
    }
  }

  if (node.root) {
    text += extractRecursive(node.root, depth + 1, maxDepth)
  }

  return text
}

// stripHtml removed in v0.9.5 — Lexical stores plain text, not HTML.

function extractAllTextFromDoc(doc) {
  const texts = []
  if (doc.title && typeof doc.title === 'string') texts.push(doc.title)
  if (doc.hero?.richText) texts.push(extractTextFromLexical(doc.hero.richText))
  if (doc.content && isLexicalJson(doc.content)) texts.push(extractTextFromLexical(doc.content))

  if (Array.isArray(doc.layout)) {
    for (const block of doc.layout) {
      extractTextFromBlock(block, texts, new WeakSet())
    }
  }
  return texts.filter(Boolean).join('\n').trim()
}

const SKIP_KEYS = new Set([
  'id', '_order', '_parent_id', '_path', '_locale', '_uuid',
  'blockType', 'blockName', 'icon', 'color', 'link', 'link_url',
  'enable_link', 'image', 'media', 'form', 'form_id', 'rating',
  'size', 'position', 'relationTo', 'value', 'updatedAt', 'createdAt',
  '_status', 'slug', 'meta', 'publishedAt', 'populatedAuthors',
])

const TEXT_FIELDS = ['title', 'description', 'heading', 'subheading', 'subtitle',
  'quote', 'author', 'role', 'label', 'link_label', 'block_name',
  'caption', 'alt', 'text', 'summary', 'excerpt']

function extractTextFromBlock(obj, texts, visited, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return
  if (visited.has(obj)) return
  visited.add(obj)

  if (Array.isArray(obj)) {
    for (const item of obj) extractTextFromBlock(item, texts, visited, depth + 1)
    return
  }

  for (const [key, value] of Object.entries(obj)) {
    if (SKIP_KEYS.has(key)) continue
    if (isLexicalJson(value)) { texts.push(extractTextFromLexical(value)); continue }
    if (typeof value === 'string' && value.length > 2 && value.length < 5000) {
      if (/^(https?:|\/|#|\d{4}-\d{2}|[0-9a-f-]{36}|data:|mailto:)/i.test(value)) continue
      if (/^\{.*\}$/.test(value) || /^\[.*\]$/.test(value)) continue
      if (TEXT_FIELDS.includes(key)) texts.push(value)
    }
    if (typeof value === 'object' && value !== null) {
      extractTextFromBlock(value, texts, visited, depth + 1)
    }
  }
}

// ---- LanguageTool check ----

async function checkWithLanguageTool(text, language = 'fr') {
  const disabledRules = [
    'WHITESPACE_RULE', 'COMMA_PARENTHESIS_WHITESPACE', 'UNPAIRED_BRACKETS',
    'FR_SPELLING_RULE',
  ].join(',')

  const params = new URLSearchParams({ text: text.slice(0, 18000), language, disabledRules })

  const res = await fetch(LANGUAGETOOL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) throw new Error(`LanguageTool ${res.status}`)
  const data = await res.json()
  return data.matches || []
}

// ---- Filters (from filters.ts) ----

const DEFAULT_SKIP_RULES = new Set([
  'WHITESPACE_RULE', 'COMMA_PARENTHESIS_WHITESPACE', 'UNPAIRED_BRACKETS',
  'UPPERCASE_SENTENCE_START', 'FRENCH_WHITESPACE', 'MORFOLOGIK_RULE_FR_FR',
  'APOS_TYP', 'APOS_INCORRECT', 'POINT_VIRGULE', 'DASH_RULE', 'FR_SPELLING_RULE',
  'FRENCH_WORD_REPEAT_RULE', 'MOT_TRAIT_MOT', 'PAS_DE_TRAIT_UNION',
  'D_N', 'DOUBLES_ESPACES', 'ESPACE_ENTRE_VIRGULE_ET_MOT', 'ESPACE_ENTRE_POINT_ET_MOT',
  'PRONOMS_PERSONNELS_MINUSCULE', 'DET_MAJ_SENT_START', 'FR_SPLIT_WORDS_HYPHEN',
])

const DEFAULT_SKIP_CATEGORIES = new Set([
  'TYPOGRAPHY', 'TYPOS', 'STYLE',
  'CAT_TYPOGRAPHIE', 'REPETITIONS_STYLE', 'CAT_REGLES_DE_BASEE',
])

const CUSTOM_DICTIONARY = [
  'ConsilioWEB', 'Next.js', 'Payload', 'TypeScript', 'JavaScript',
  'React', 'React Native', 'Expo', 'Flutter', 'Node.js', 'Tailwind', 'cross-platform',
  'mobile-first', 'utility-first', 'multi-appareils',
  'useMemo', 'useCallback', 'useEffect', 'useState', 'useRef',
  'SEO', 'RGPD', 'RGESN', 'CMS', 'API', 'CSS', 'HTML', 'PHP',
  'WordPress', 'PrestaShop', 'Symfony', 'WooCommerce', 'Shopify',
  'Matomo', 'n8n', 'Figma', 'Vercel', 'Infomaniak',
  'Corrèze', 'Limousin', 'Ussel', 'Tulle', 'Brive', 'Limoges',
  'Aurillac', 'Clermont-Ferrand', 'Nouvelle-Aquitaine',
  // Hosting & brands
  'o2switch', 'PlanetHoster', 'OVH', 'Brevo', 'Whitespark',
  // English tech terms
  'pull request', 'pull requests', 'brute force', 'rich snippets',
  'lazy loading', 'code splitting', 'tree shaking', 'hot reload',
  'Content-Security-Policy', 'X-Frame-Options', 'Strict-Transport-Security',
  // Multi-word tech terms (context-aware matching)
  'variable fonts', 'container queries', 'media query', 'media queries',
  'server components', 'server actions', 'App Router', 'use cache',
  'pré-rendre', 'pré-rendu', 'pré-rendue', 'pré-rendues',
].map(w => w.toLowerCase())

function filterMatch(m) {
  const ruleId = m.rule.id
  const category = m.rule.category.id
  const original = m.context.text.slice(m.context.offset, m.context.offset + m.context.length)
  const isPremium = m.rule.isPremium

  if (isPremium) return { skip: true, reason: 'premium rule' }
  if (DEFAULT_SKIP_RULES.has(ruleId)) return { skip: true, reason: `skip rule: ${ruleId}` }
  if (DEFAULT_SKIP_CATEGORIES.has(category)) return { skip: true, reason: `skip category: ${category}` }

  if (original) {
    const lower = original.toLowerCase()
    for (const word of CUSTOM_DICTIONARY) {
      if (lower.includes(word) || word.includes(lower)) {
        return { skip: true, reason: `dictionary: "${word}"` }
      }
    }
  }

  // Context-aware multi-word dictionary check
  if (m.context && m.context.text) {
    const ctxLower = m.context.text.toLowerCase()
    for (const word of CUSTOM_DICTIONARY) {
      if (word.includes(' ') && ctxLower.includes(word)) {
        return { skip: true, reason: `context dict: "${word}"` }
      }
    }
  }

  if (original && original.length <= 1 && category !== 'GRAMMAR') {
    return { skip: true, reason: 'single char, not grammar' }
  }

  if (ruleId.includes('REPET') || category === 'CAT_REGLES_DE_BASE') {
    if (original) {
      const lower = original.toLowerCase()
      for (const word of CUSTOM_DICTIONARY) {
        if (lower.includes(word) || word.includes(lower)) {
          return { skip: true, reason: `repetition of dict word: "${word}"` }
        }
      }
    }
  }

  return { skip: false, reason: null }
}

// ---- Main ----

async function main() {
  console.log(`\n🔍 Debug spellcheck: slug="${slug}" api="${apiBase}"\n`)

  // 1. Fetch page
  console.log('📄 Fetching page...')
  const pageRes = await fetch(`${apiBase}/api/pages?where[slug][equals]=${slug}&depth=1&limit=1`)
  let data = await pageRes.json()
  let doc = data.docs?.[0]

  if (!doc) {
    // Try posts
    const postRes = await fetch(`${apiBase}/api/posts?where[slug][equals]=${slug}&depth=1&limit=1`)
    data = await postRes.json()
    doc = data.docs?.[0]
  }

  if (!doc) {
    console.error(`❌ Document "${slug}" not found`)
    process.exit(1)
  }

  console.log(`   Title: ${doc.title}`)
  console.log(`   ID: ${doc.id}`)

  // 2. Extract text
  console.log('\n📝 Extracting text...')
  const text = extractAllTextFromDoc(doc)
  console.log(`   Words: ${text.split(/\s+/).filter(w => w.length > 0).length}`)
  console.log(`   Length: ${text.length} chars`)
  console.log('\n--- EXTRACTED TEXT (first 2000 chars) ---')
  console.log(text.slice(0, 2000))
  console.log('--- END ---\n')

  // 3. Check with LanguageTool
  console.log('🔎 Checking with LanguageTool...')
  const matches = await checkWithLanguageTool(text)
  console.log(`   Raw matches: ${matches.length}\n`)

  // 4. Show all matches with filter decisions
  let kept = 0
  let filtered = 0

  for (const m of matches) {
    const original = m.context.text.slice(m.context.offset, m.context.offset + m.context.length)
    const replacement = m.replacements?.[0]?.value || '(none)'
    const { skip, reason } = filterMatch(m)

    if (skip) {
      filtered++
      console.log(`   ⏭️  FILTERED: "${original}" → "${replacement}"`)
      console.log(`      Rule: ${m.rule.id} | Cat: ${m.rule.category.id} | Reason: ${reason}`)
    } else {
      kept++
      console.log(`   ⚠️  KEPT: "${original}" → "${replacement}"`)
      console.log(`      Rule: ${m.rule.id} | Cat: ${m.rule.category.id} | ${m.message}`)
      console.log(`      Context: ...${m.context.text}...`)
    }
    console.log()
  }

  console.log(`\n📊 Summary: ${matches.length} raw → ${kept} kept, ${filtered} filtered out\n`)
}

main().catch(console.error)
