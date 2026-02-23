<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=28&pause=1000&color=2563EB&center=true&vCenter=true&width=600&lines=@consilioweb/spellcheck;Payload+CMS+Spellcheck+Plugin;LanguageTool+%2B+Claude+AI;Dashboard+%2B+Sidebar+%2B+Auto-check" alt="Typing SVG" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@consilioweb/spellcheck"><img src="https://img.shields.io/npm/v/@consilioweb/spellcheck?color=2563eb&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@consilioweb/spellcheck"><img src="https://img.shields.io/npm/dm/@consilioweb/spellcheck?color=22c55e" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/Payload_CMS-3.x-blue" alt="Payload CMS 3.x" />
  <img src="https://img.shields.io/badge/LanguageTool-API-green" alt="LanguageTool" />
  <img src="https://img.shields.io/badge/i18n-FR%20%2F%20EN-purple" alt="i18n" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6" alt="TypeScript" />
</p>

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## About

**@consilioweb/spellcheck** is a Payload CMS 3 plugin that adds real-time spelling and grammar checking to your admin panel. Powered by [LanguageTool](https://languagetool.org/) with optional Claude AI semantic analysis.

| Feature | Description |
|---------|-------------|
| **Dashboard** | Full admin view at `/admin/spellcheck` with bulk scanning |
| **Sidebar Field** | Real-time spellcheck score + issues in the editor |
| **Auto-check** | Fire-and-forget hook checks content on every save |
| **One-click Fix** | Apply corrections directly in Lexical JSON |
| **LanguageTool** | Grammar, spelling, punctuation via free API |
| **Claude AI** | Optional semantic analysis (coherence, tone, phrasing) |
| **Custom Dictionary** | Whitelist tech terms, brand names, proper nouns |
| **Dynamic Dictionary** | Add/remove words from admin UI, persists in DB |
| **Offset-based Fix** | Precise corrections using LanguageTool offsets |
| **Ignore Issues** | Dismiss false positives (persists across reloads) |
| **i18n** | French and English UI translations |

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Admin Views](#admin-views)
- [Dynamic Dictionary](#dynamic-dictionary)
- [API Endpoints](#api-endpoints)
- [Engine](#engine)
- [Package Exports](#package-exports)
- [Uninstall](#uninstall)
- [Changelog](#changelog)
- [License](#license)

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Features

### Dashboard (`/admin/spellcheck`)

- **Tabbed interface** — Results tab + Dictionary tab
- **Selective scan** — Check specific pages or all documents at once
- **Checkbox selection** — Pick individual documents to scan
- **Collection filter** — Filter by collection (pages, posts, etc.)
- **Sortable table** — Sort by score, issues, word count, last checked
- **Expandable rows** — Click a document to see all issues inline
- **Before/After diff** — Visual comparison of original vs corrected text
- **Multiple suggestions** — Dropdown to choose between alternative corrections
- **One-click fix** — Apply corrections directly (issue removed from UI + DB)
- **Ignore button** — Dismiss false positives (persists in DB across reloads)
- **Add to dictionary** — Whitelist a word directly from an issue card
- **Summary cards** — Total documents, average score, issues count

### Sidebar Field

- **Score badge** — Color-coded score (green/yellow/red) in the editor sidebar
- **Issue list** — All issues with context, suggestions, and fix buttons
- **Manual check** — "Vérifier" button for on-demand analysis
- **Auto-check** — Results loaded automatically from last check

### Auto-check on Save

- **Non-blocking** — Fire-and-forget async (IIFE pattern, does not slow down saves)
- **Upsert results** — Stores/updates results in `spellcheck-results` collection
- **Configurable** — Enable/disable via `checkOnSave` option

### LanguageTool Engine

- **Free API** — No API key required (public LanguageTool API)
- **Rate-limited** — 3-second delay between requests for bulk scans
- **18K char limit** — Automatic text truncation for API compliance
- **Smart filtering** — Skip premium rules, typography, style-only issues
- **Custom dictionary** — Whitelist words that shouldn't be flagged

### Claude AI Fallback (Optional)

- **Semantic analysis** — Checks coherence, tone, phrasing, missing words
- **Complementary** — Does NOT duplicate LanguageTool (no spelling/grammar)
- **Cost-efficient** — Uses Claude Haiku for fast, cheap analysis
- **Opt-in** — Disabled by default, enable via `enableAiFallback: true`

### Dynamic Dictionary

- **Admin UI** — Manage dictionary from the "Dictionnaire" tab in the dashboard
- **Add words** — Single word or comma-separated bulk input
- **Import** — Paste a list of words (one per line or comma-separated)
- **Export** — Download all dictionary words as a `.txt` file
- **Search & filter** — Find words in the dictionary
- **Bulk delete** — Select and remove multiple words at once
- **Merged sources** — Config `customDictionary` (defaults) + DB dictionary (dynamic)
- **5-min cache** — Dictionary loaded from DB with in-memory TTL cache
- **Auto-schema** — Plugin auto-creates missing DB columns on init (SQLite/Postgres)

### Lexical JSON Support

- **Recursive extraction** — Traverses Lexical AST to extract plain text
- **Code block skip** — Ignores code blocks (not natural language)
- **Offset-based fixes** — Precise corrections using LanguageTool offsets (v0.8.0+)
- **Legacy fallback** — Substring search for backwards compatibility
- **Multi-field** — Extracts from hero, content, layout blocks, columns

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Installation

```bash
# npm
npm install @consilioweb/spellcheck

# pnpm
pnpm add @consilioweb/spellcheck

# yarn
yarn add @consilioweb/spellcheck
```

| Peer Dependency | Version |
|----------------|---------|
| `payload` | `^3.0.0` |
| `@payloadcms/next` | `^3.0.0` |
| `@payloadcms/ui` | `^3.0.0` |
| `react` | `^18.0.0 \|\| ^19.0.0` |

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Quick Start

Add the plugin to your Payload config:

```typescript
// src/plugins/index.ts (or payload.config.ts)
import { spellcheckPlugin } from '@consilioweb/spellcheck'

export default buildConfig({
  plugins: [
    spellcheckPlugin({
      collections: ['pages', 'posts'],
      language: 'fr',
    }),
  ],
})
```

Then regenerate the import map:

```bash
npx payload generate:importmap
```

That's it! The plugin automatically:
- Creates `spellcheck-results` and `spellcheck-dictionary` collections (hidden from admin nav)
- Registers API endpoints (`validate`, `fix`, `bulk`, `status`, `dictionary`)
- Adds a sidebar field to your target collections
- Creates a dashboard view at `/admin/spellcheck` (Results + Dictionary tabs)
- Adds an `afterChange` hook for auto-checking on save
- Auto-fixes missing DB columns on init (SQLite/Postgres `push:true` compatibility)

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Configuration

```typescript
spellcheckPlugin({
  // Target collections (default: ['pages', 'posts'])
  collections: ['pages', 'posts'],

  // Rich text field name (default: 'content')
  contentField: 'content',

  // LanguageTool language (default: 'fr')
  language: 'fr',

  // Auto-check on save (default: true)
  checkOnSave: true,

  // Sidebar field in editor (default: true)
  addSidebarField: true,

  // Dashboard view at /admin/spellcheck (default: true)
  addDashboardView: true,

  // Base path for API endpoints (default: '/spellcheck')
  endpointBasePath: '/spellcheck',

  // ── Filtering ──────────────────────────────────────

  // LanguageTool rule IDs to skip
  skipRules: ['FR_SPELLING_RULE', 'WHITESPACE_RULE'],

  // LanguageTool categories to skip
  skipCategories: ['TYPOGRAPHY', 'STYLE'],

  // Words to never flag as errors
  customDictionary: [
    'Next.js', 'Payload', 'TypeScript', 'SEO',
    'Corrèze', 'Limoges', 'ConsilioWEB',
  ],

  // Minimum score threshold for warnings (default: 80)
  warningThreshold: 80,

  // ── Claude AI Fallback (optional) ──────────────────

  // Enable semantic analysis via Claude (default: false)
  enableAiFallback: false,

  // Anthropic API key (required if enableAiFallback is true)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
})
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `string[]` | `['pages', 'posts']` | Collections to check |
| `contentField` | `string` | `'content'` | Rich text field name |
| `language` | `string` | `'fr'` | LanguageTool language code |
| `checkOnSave` | `boolean` | `true` | Auto-check on document save |
| `addSidebarField` | `boolean` | `true` | Add sidebar field in editor |
| `addDashboardView` | `boolean` | `true` | Add `/admin/spellcheck` view |
| `endpointBasePath` | `string` | `'/spellcheck'` | Base path for API endpoints |
| `enableAiFallback` | `boolean` | `false` | Enable Claude AI semantic analysis |
| `anthropicApiKey` | `string` | — | Anthropic API key for Claude |
| `skipRules` | `string[]` | `[]` | LanguageTool rule IDs to skip |
| `skipCategories` | `string[]` | `[]` | LanguageTool categories to skip |
| `customDictionary` | `string[]` | `[]` | Words to never flag |
| `warningThreshold` | `number` | `80` | Score below which a warning is shown |

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Admin Views

### Dashboard (`/admin/spellcheck`)

The dashboard provides a complete overview of your content's spelling quality:

- **Summary cards** — Document count, average score, total issues, error-free count
- **Sortable table** — Click column headers to sort by score, issues, words, date
- **Expandable rows** — Click any row to see detailed issues with context and suggestions
- **Bulk scan** — "Scanner tout" analyzes all published documents sequentially
- **One-click fix** — Apply a correction directly from the expanded issue view

### Sidebar Field

The sidebar field appears in the editor for every target collection:

- **Score badge** — Color-coded (green ≥95, yellow ≥80, red <80)
- **Stats bar** — Word count, issue count, last check time
- **Issue cards** — Each issue shows message, context with highlighted error, suggestion
- **Fix button** — Applies the suggestion directly in the Lexical JSON
- **Ignore button** — Removes the issue from the current view

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## API Endpoints

All endpoints require authentication (Payload admin user).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/spellcheck/validate` | `POST` | Check a single document or raw text |
| `/api/spellcheck/fix` | `POST` | Apply a correction in Lexical JSON (offset-based) |
| `/api/spellcheck/bulk` | `POST` | Scan all documents (sequential, rate-limited) |
| `/api/spellcheck/status` | `GET` | Get current bulk scan progress |
| `/api/spellcheck/dictionary` | `GET` | List all dictionary words |
| `/api/spellcheck/dictionary` | `POST` | Add word(s) to dictionary |
| `/api/spellcheck/dictionary` | `DELETE` | Remove word(s) from dictionary |

### POST `/api/spellcheck/validate`

```json
// Check a document by ID
{ "id": "123", "collection": "pages" }

// Check raw text
{ "text": "Ceci est une test.", "language": "fr" }
```

**Response:**

```json
{
  "docId": "123",
  "collection": "pages",
  "score": 85,
  "issueCount": 2,
  "wordCount": 450,
  "issues": [
    {
      "ruleId": "GRAMMAR",
      "category": "GRAMMAR",
      "message": "Le déterminant « une » ne correspond pas...",
      "context": "Ceci est une test.",
      "original": "une",
      "replacements": ["un"],
      "source": "languagetool"
    }
  ],
  "lastChecked": "2025-02-22T20:30:00.000Z"
}
```

### POST `/api/spellcheck/fix`

```json
{
  "id": "123",
  "collection": "pages",
  "original": "une test",
  "replacement": "un test",
  "offset": 42,
  "length": 8
}
```

> `offset` and `length` enable precise offset-based targeting (v0.8.0+). Falls back to substring search if omitted.

### GET `/api/spellcheck/dictionary`

**Response:**

```json
{ "words": [{ "id": "1", "word": "typescript", "addedBy": { "email": "admin@example.com" }, "createdAt": "..." }], "count": 1 }
```

### POST `/api/spellcheck/dictionary`

```json
// Single word
{ "word": "TypeScript" }

// Multiple words
{ "words": ["TypeScript", "Next.js", "Payload"] }
```

### DELETE `/api/spellcheck/dictionary`

```json
// Single
{ "id": "abc123" }

// Multiple
{ "ids": ["abc123", "def456"] }
```

### POST `/api/spellcheck/bulk`

```json
// Scan all configured collections
{}

// Scan a specific collection
{ "collection": "posts" }
```

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Engine

### Text Extraction

The plugin extracts text from Payload documents by recursively traversing:

1. **Title** — Document title
2. **Hero** — `hero.richText` (Lexical JSON)
3. **Content** — Main content field (Lexical JSON)
4. **Layout blocks** — Each block's `richText` and `columns[].richText`

Code blocks are automatically skipped (not natural language).

### LanguageTool

- **API**: `POST https://api.languagetool.org/v2/check` (free, no auth)
- **Limit**: 18,000 characters per request (auto-truncated)
- **Rate**: 3-second delay between bulk requests
- **Timeout**: 30 seconds per request

### Filtering

Issues are filtered through multiple layers:

1. **Premium rules** — Skipped (free API only)
2. **Configured rules** — `skipRules` option
3. **Configured categories** — `skipCategories` option
4. **Custom dictionary** — Case-insensitive word matching
5. **Single-character** — Skipped (often punctuation false positives)

### Scoring

Score = `max(0, 100 - (issues / words * 1000))`

- **100** — No issues
- **90+** — Excellent (green)
- **80+** — Good (yellow)
- **<80** — Needs work (red)

### Claude AI (Optional)

When `enableAiFallback: true`, the plugin also sends text to Claude Haiku for:

- Inconsistent tone or register
- Incoherent statements or contradictions
- Awkward phrasing
- Missing words that change meaning

Claude issues are tagged with `source: 'claude'` and category `COHERENCE`, `TONE`, `PHRASING`, or `MISSING_WORD`.

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Collections

The plugin auto-creates two collections:

| Collection | Slug | Description |
|------------|------|-------------|
| SpellCheck Results | `spellcheck-results` | Stores check results per document |
| SpellCheck Dictionary | `spellcheck-dictionary` | Dynamic dictionary (one doc per word) |

**Results fields**: `docId`, `collection`, `title`, `slug`, `score`, `issueCount`, `wordCount`, `issues` (JSON), `lastChecked`

**Dictionary fields**: `word` (text, unique, indexed), `addedBy` (relationship to users)

Both collections are hidden from the admin nav. The dictionary is managed via the Dashboard's "Dictionnaire" tab or the REST API.

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Package Exports

### Main Entry (`@consilioweb/spellcheck`)

```typescript
// Plugin
export { spellcheckPlugin } from './plugin'

// Types
export type { SpellCheckPluginConfig, SpellCheckIssue, SpellCheckResult } from './types'

// Engine (for programmatic use)
export { extractTextFromLexical, countWords } from './engine/lexicalParser'
export { checkWithLanguageTool } from './engine/languagetool'
export { checkWithClaude } from './engine/claude'
export { filterFalsePositives, calculateScore } from './engine/filters'

// Dictionary cache
export { loadDictionaryWords, invalidateDictionaryCache } from './endpoints/dictionary'

// i18n
export { getTranslations, getScoreLabel } from './i18n'
```

### Client Entry (`@consilioweb/spellcheck/client`)

```typescript
export { SpellCheckField } from './components/SpellCheckField'
export { SpellCheckDashboard } from './components/SpellCheckDashboard'
export { IssueCard } from './components/IssueCard'
```

### Views Entry (`@consilioweb/spellcheck/views`)

```typescript
export { SpellCheckView } from './views/SpellCheckView'
```

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Requirements

- **Node.js** >= 18
- **Payload CMS** 3.x
- **React** 18.x or 19.x
- **Any Payload DB adapter** (SQLite, PostgreSQL, MongoDB)

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Uninstall

### Automatic (recommended)

```bash
npx spellcheck-uninstall
```

This will:
1. Remove all `@consilioweb/spellcheck` imports and plugin calls from your source files
2. Drop the `spellcheck_results` table and indexes from your database
3. Remove the npm package
4. Regenerate the import map

> Use `--keep-data` to preserve the database table.

### Manual

1. Remove the plugin from your config
2. Run `npx payload generate:importmap`
3. (Optional) Drop the database table:

```sql
-- SQLite
DROP INDEX IF EXISTS `spellcheck_results_doc_id_idx`;
DROP INDEX IF EXISTS `spellcheck_results_collection_idx`;
DROP INDEX IF EXISTS `spellcheck_results_last_checked_idx`;
DROP TABLE IF EXISTS `spellcheck_results`;
```

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## Changelog

### v0.8.1

- **Fix**: Corrections now remove the issue from the UI immediately (optimistic update)
- **Fix**: "Ignorer" persists in DB across page reloads (was local state only)
- **Fix**: Auto-fix missing DB columns on init (`push:true` compatibility for SQLite/Postgres)

### v0.8.0

- **New**: Dynamic dictionary — manage words from the admin dashboard (add/remove/import/export)
- **New**: `spellcheck-dictionary` collection (one document per word, merged with config dictionary)
- **New**: Dictionary REST API (GET/POST/DELETE at `/api/spellcheck/dictionary`)
- **New**: Offset-based corrections — precise fix targeting using LanguageTool offsets
- **New**: "Add to dictionary" button on issue cards (+ Dico)
- **New**: "Ignore" button to dismiss false positives
- **New**: Dictionary tab in the dashboard with search, bulk delete, import/export
- **New**: In-memory cache (5-min TTL) for dictionary DB queries
- **Changed**: `filterFalsePositives` is now async (merges config + DB dictionaries)
- **Changed**: Fix endpoint accepts `offset` and `length` parameters (falls back to substring search)

### v0.5.0 — v0.7.0

- Custom dictionary config, contextual multi-word filtering, background scan
- Lexical ghost space fix, extended French dictionary
- Contextual offset, manual edit input, repetition filter

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" alt="-----" />

## License

MIT License - see [LICENSE](LICENSE) for details.

<p align="center">
  <br />
  Made with ❤️ by <a href="https://consilioweb.fr">ConsilioWEB</a>
  <br />
  <br />
  <a href="https://www.linkedin.com/in/christophe-lopez-dev/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
  <a href="https://github.com/pOwn3d"><img src="https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white" alt="GitHub" /></a>
  <a href="https://consilioweb.fr"><img src="https://img.shields.io/badge/Web-consilioweb.fr-2563eb" alt="Website" /></a>
</p>
