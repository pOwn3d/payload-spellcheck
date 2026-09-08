# @consilioweb/payload-spellcheck

> Spelling, grammar and readability checking inside the Payload CMS 3 admin panel, powered by LanguageTool with an optional Claude semantic pass.

[![npm](https://img.shields.io/npm/v/@consilioweb/payload-spellcheck.svg)](https://www.npmjs.com/package/@consilioweb/payload-spellcheck)
[![license](https://img.shields.io/npm/l/@consilioweb/payload-spellcheck.svg)](LICENSE)
[![Payload CMS](https://img.shields.io/badge/Payload%20CMS-3.x-blue.svg)](https://payloadcms.com)

> [!IMPORTANT]
> **Next.js 16 + Turbopack — known issue.** With **Next.js 16** and Turbopack (the default bundler),
> `next build` may fail with `createContext is not a function`. This is a
> [known Payload CMS issue](https://github.com/payloadcms/payload/issues/15429)
> ([discussion](https://github.com/payloadcms/payload/discussions/14330)) — not specific to this plugin.
>
> **Workaround** — in your admin page (`src/app/(payload)/admin/[[...segments]]/page.tsx`):
> ```ts
> export const dynamic = 'force-dynamic'
> ```
>
> And list every `@consilioweb/*` package in `transpilePackages` in `next.config.ts`:
> ```ts
> transpilePackages: ['@consilioweb/payload-spellcheck', /* ...other @consilioweb packages */],
> ```
>
> Next.js 15 works without any workaround.

## About

`@consilioweb/payload-spellcheck` checks the editorial content of your Payload documents where it is
written, instead of after publication: a score and an issue list in the editor sidebar, a dashboard
that scans every document of the configured collections, and a one-click fix that rewrites the
Lexical JSON in place at the exact offset LanguageTool reported.

Spelling and grammar come from [LanguageTool](https://languagetool.org/) — the free public API needs
no key, and a self-hosted instance is a one-line option. Claude can be enabled on top for what a
grammar checker cannot see (tone, coherence, missing words); it never replaces LanguageTool. False
positives are absorbed by a dictionary that lives half in the config and half in the database, so an
editor can whitelist a brand name without a deploy.

Full release history: [CHANGELOG.md](CHANGELOG.md).

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Engine](#engine)
- [API Endpoints](#api-endpoints)
- [Collections](#collections)
- [Package Exports](#package-exports)
- [Requirements](#requirements)
- [Uninstall](#uninstall)
- [Migration from `@consilioweb/spellcheck`](#migration-from-consiliowebspellcheck)
- [Support](#support)
- [License](#license)

## Features

- **Dashboard** at `/admin/spellcheck` — sortable results table (score, issues, word count,
  readability, last check), expandable rows, per-issue fix / ignore / add-to-dictionary, bulk scan
  with live progress, and a dictionary tab.
- **Sidebar field** in the editor of every target collection — score badge, readability badge, issue
  cards with one-click fix, manual correction, ignore, add to dictionary.
- **Score column** in collection list views (labelled `Ortho`), removable with `addListColumn: false`.
- **Auto-check on save** — non-blocking `afterChange` hook. It skips autosave ticks and the plugin's
  own writes, so typing does not flood the LanguageTool API.
- **LanguageTool engine** — spelling, grammar and punctuation through the free public API (no key
  required), or any self-hosted instance via `languageToolUrl`.
- **Claude semantic pass (opt-in)** — coherence, tone, phrasing and missing words, *in addition to*
  LanguageTool. A Claude failure degrades the result; it never fails the request.
- **Readability analysis** — Flesch-Kincaid (English) / Kandel-Moles (French), stored with every
  result and displayed in the dashboard and the sidebar.
- **Consistency check** — mixed variants of the same term in a document (`TypeScript` vs
  `typescript`, `e-commerce` vs `ecommerce`). Computed, stored on the result and returned by
  `/validate`; no dedicated UI yet.
- **Two-source dictionary** — static `customDictionary` from the config, merged with a
  `spellcheck-dictionary` collection editors manage from the dashboard (add, import, export, search,
  bulk delete), cached in memory for 5 minutes.
- **Offset-based fixes** — a correction applied at the reported offset (or at the offset a drift
  search recovered) is re-read from the mutated document and refused rather than persisted when the
  replacement did not land where it should. The last-resort substring fallback carries no offset, so
  that verification does not cover it. A pending draft is corrected as a draft, leaving the published
  version untouched.
- **i18n, sidebar only** — the editor sidebar field and the issue cards it renders follow Payload's
  active locale (French / English). The `/admin/spellcheck` dashboard is **not** translated: its
  labels are French, and the issue cards inside it fall back to their French strings.

## Installation

```bash
# npm
npm install @consilioweb/payload-spellcheck

# pnpm
pnpm add @consilioweb/payload-spellcheck

# yarn
yarn add @consilioweb/payload-spellcheck
```

| Peer dependency | Version | Required |
|-----------------|---------|----------|
| `payload` | `^3.0.0` | yes |
| `@payloadcms/next` | `^3.0.0` | optional — needed for the dashboard view |
| `@payloadcms/ui` | `^3.0.0` | optional — needed for the admin components |
| `react` | `^18.0.0 \|\| ^19.0.0` | optional — needed for the admin components |

An installer binary is shipped with the package. It adds the plugin call to your plugins file
(`src/plugins/index.ts`, `src/plugins.ts`, or any file exporting `plugins` as a `Plugin[]`) and
regenerates the import map:

```bash
npx spellcheck-install --collections pages,posts --language fr
```

## Quick Start

```ts
// src/payload.config.ts
import { buildConfig } from 'payload'
import { spellcheckPlugin } from '@consilioweb/payload-spellcheck'

export default buildConfig({
  // ...
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

> [!WARNING]
> **Prerequisite — the admin role.** By default every endpoint, the dashboard view **and the two
> plugin collections** are reserved for users carrying `role: 'admin'`, or a `roles` array containing
> `'admin'`. On a Payload install whose `Users` collection has no such field, **nothing is readable**:
> the endpoints answer `403`, the dashboard redirects to `/admin`, and the sidebar score stays empty.
> Either add the field, or pass your own check:
>
> ```ts
> spellcheckPlugin({
>   // `req` is passed directly — NOT destructured as `{ req }`
>   access: (req) => req.user?.collection === 'users',
> })
> ```
>
> Do **not** write `access: (req) => Boolean(req.user)`. If your project has a second auth
> collection — customers, members, partners — those accounts also carry a `payload-token`, and
> `Boolean(req.user)` would hand them the drafts of every scanned collection plus the ability to
> rewrite published documents through `/fix`. Always compare `req.user.collection` with the
> collection that backs your admin panel (`config.admin.user`, usually `users`). The plugin now
> enforces that comparison itself, before your `access` function runs, so a permissive snippet is no
> longer an open door — but the explicit check is still what you should ship.

The plugin then:

- registers nine REST endpoints under `/api/spellcheck` (see [API Endpoints](#api-endpoints));
- creates the `spellcheck-results` and `spellcheck-dictionary` collections (hidden from the admin nav);
- adds a sidebar field and a score column to every collection listed in `collections`;
- registers the dashboard view at `/admin/spellcheck` (Results + Dictionary tabs);
- adds an `afterChange` hook that re-checks a document on save;
- on init, adds the `spellcheck_dictionary_id` column that Payload's `push: true` omits from
  `payload_locked_documents_rels` (SQLite; on other adapters it logs the `ALTER TABLE` to run).

## Configuration

```ts
spellcheckPlugin({
  // Target collections (default: ['pages', 'posts'])
  collections: ['pages', 'posts'],

  // Rich text field name (default: 'content')
  contentField: 'content',

  // LanguageTool language code (default: 'fr')
  language: 'fr',

  // ── Filtering ──────────────────────────────────────

  // Rule IDs to skip — ADDED to the built-in defaults, never replacing them.
  // An ID already present in DEFAULT_SKIP_RULES (or whose whole category is
  // skipped) changes nothing: check the exported lists first, and take IDs
  // from the `ruleId` field of a /validate response.
  // Never list a spelling rule here (MORFOLOGIK_*): those carry the
  // misspellings the plugin exists to report. Use customDictionary for
  // legitimate proper nouns instead.
  // Below: LanguageTool's language-independent word-repetition rule. Its
  // French variant, FRENCH_WORD_REPEAT_RULE, is already a default.
  skipRules: ['WORD_REPEAT_RULE'],

  // Categories to skip — ADDED to the built-in defaults, which already
  // contain 'TYPOGRAPHY' and 'STYLE'.
  // 'TYPOS' is the category of every misspelling — do not add it here.
  // Below: LanguageTool's English redundancy category, as an example.
  skipCategories: ['REDUNDANCY'],

  // Words never flagged as errors, merged with the DB dictionary
  customDictionary: ['Next.js', 'Payload', 'TypeScript', 'ConsilioWEB'],

  // ── Claude semantic pass (optional) ────────────────

  enableAiFallback: false,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  // ── Access control ─────────────────────────────────

  // The whole request is the argument — do NOT destructure it as `{ req }`.
  // Gates the endpoints, the dashboard view AND the two plugin collections.
  access: (req) => req.user?.role === 'admin',
})
```

### Options reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `collections` | `string[]` | `['pages', 'posts']` | Collections to check. Also the allowlist every endpoint validates its `collection` against |
| `contentField` | `string` | `'content'` | Rich text field to extract |
| `language` | `string` | `'fr'` | LanguageTool language code |
| `checkOnSave` | `boolean` | `true` | Add the `afterChange` auto-check hook |
| `addSidebarField` | `boolean` | `true` | Add the sidebar field to the editor |
| `addDashboardView` | `boolean` | `true` | Register the `/admin/spellcheck` view |
| `addListColumn` | `boolean` | `true` | Add the `Ortho` score column to list views |
| `endpointBasePath` | `string` | `'/spellcheck'` | Base path of the REST endpoints. See the caveat below |
| `enableAiFallback` | `boolean` | `false` | Enable the Claude semantic pass |
| `anthropicApiKey` | `string` | — | Anthropic API key, required when `enableAiFallback` is on |
| `skipRules` | `string[]` | `[]` | Rule IDs to skip — **added** to the default list |
| `skipCategories` | `string[]` | `[]` | Categories to skip — **added** to the default list |
| `overrideDefaultSkipRules` | `string[]` | — | Replaces the default rule list instead of stacking on it. `[]` disables default rule filtering |
| `overrideDefaultSkipCategories` | `string[]` | — | Replaces the default category list. `[]` disables default category filtering |
| `customDictionary` | `string[]` | `[]` | Words never flagged, merged with the DB dictionary |
| `languageToolUrl` | `string` | `'https://api.languagetool.org/v2/check'` | LanguageTool endpoint — set it for a self-hosted instance |
| `warningThreshold` | `number` | `80` | **Accepted but currently unread.** The score colours in the UI are hard-coded (green ≥ 95, amber ≥ 80, red below) |
| `autoFixSchema` | `boolean` | `true` | Add the missing `payload_locked_documents_rels` column on init |
| `maxDocs` | `number` | — | Cap the number of documents a single bulk scan processes. Unset = no cap |
| `acknowledgePublicApi` | `boolean` | `false` | Silence the start-up warning about sending content to the public LanguageTool API (see [Data sent to third parties](#data-sent-to-third-parties)) |
| `access` | `(req) => boolean` | admin only | Gates the endpoints, the dashboard view and both plugin collections. The whole request is the argument |
| `packageName` | `string` | `'@consilioweb/payload-spellcheck'` | Package name used to build admin component paths — for monorepos and aliased installs |
| `trustProxy` | `boolean` | `true` | Trust `x-forwarded-for` / `x-real-ip` in the rate limiter. Only used for the fallback bucket — the limiter keys on the authenticated account |
| `rateLimits` | `object` | see below | Per-endpoint rate limits |
| `timeouts` | `object` | see below | Timeouts and length limits |

> [!NOTE]
> `endpointBasePath` moves the REST endpoints only. The bundled dashboard and sidebar call
> `/api/spellcheck/...` literally, so changing the base path breaks the admin UI while leaving the
> API usable.

> [!NOTE]
> The access check runs **before** the rate limiter, and the limiter keys on
> `user.collection:user.id` rather than on the client IP. An anonymous caller is answered `403`
> without ever creating an entry in the limiter, so it can no longer grow the limiter's memory with
> forged `X-Forwarded-For` values nor exhaust a legitimate admin's budget by forging their IP.
> `trustProxy` now only affects the fallback bucket used when a request somehow reaches the limiter
> without an account id.

#### `rateLimits`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rateLimits.validate` | `number` | `30` | Max requests per window for `/validate` |
| `rateLimits.fix` | `number` | `20` | Max requests per window for `/fix` |
| `rateLimits.fixAll` | `number` | `5` | Max requests per window for `/fix-all` |
| `rateLimits.bulk` | `number` | `3` | Max requests per window for `/bulk` |
| `rateLimits.status` | `number` | `60` | Max requests per window for `/status` (the dashboard polls it every 2 s) |
| `rateLimits.dictionary` | `number` | `60` | Max requests per window for `/dictionary` |
| `rateLimits.windowMs` | `number` | `60000` | Rate limit window, in milliseconds |

#### `timeouts`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeouts.languageTool` | `number` | `30000` | LanguageTool request timeout (ms) |
| `timeouts.claude` | `number` | `60000` | Claude request timeout (ms) |
| `timeouts.maxTextLengthLanguageTool` | `number` | `18000` | Max characters sent to LanguageTool (text is truncated) |
| `timeouts.maxTextLengthClaude` | `number` | `8000` | Max characters sent to Claude (text is truncated) |
| `timeouts.bulkRateLimitDelay` | `number` | `3000` | Delay between LanguageTool calls during a bulk scan (ms) |
| `timeouts.bulkStaleTimeout` | `number` | `600000` | A bulk job with no progress for this long is declared dead (ms) |

### Default skip lists

`DEFAULT_SKIP_RULES` and `DEFAULT_SKIP_CATEGORIES` are exported from the package root, so a custom
list can be derived from them rather than retyped:

```ts
import { spellcheckPlugin, DEFAULT_SKIP_RULES } from '@consilioweb/payload-spellcheck'

spellcheckPlugin({
  overrideDefaultSkipRules: DEFAULT_SKIP_RULES.filter((r) => r !== 'DASH_RULE'),
})
```

The defaults cover whitespace, typography, dash and repetition noise typical of CMS extraction.
Since 0.15.0 they deliberately **do not** contain the `TYPOS` category nor `MORFOLOGIK_RULE_FR_FR`:
those carry the misspellings the plugin exists to report. To restore the pre-0.15 silence:
`skipCategories: ['TYPOS'], skipRules: ['MORFOLOGIK_RULE_FR_FR']`.

## Engine

### Text extraction

Text is extracted by walking the document in this order, each part contributing one segment:

1. `title` — plain string
2. `hero.richText` — Lexical JSON
3. the configured `contentField` — Lexical JSON
4. `layout[]` — each block's rich text, plain text fields and nested columns

Code blocks are skipped, as are values that look like IDs, URLs or dates. Each segment records how
much leading whitespace the trim removed, so a correction lands on the character the offset really
points at.

### LanguageTool

- Default endpoint: `POST https://api.languagetool.org/v2/check` — free, no authentication
- Text truncated to 18 000 characters (`timeouts.maxTextLengthLanguageTool`)
- 30 s request timeout (`timeouts.languageTool`)
- 3 s between calls during a bulk scan (`timeouts.bulkRateLimitDelay`)

A failed call is never reported as a clean document: `/validate` answers `502` with
`{ "checkFailed": true }`, the auto-check hook logs a warning and leaves the stored result alone, and
a bulk scan counts the document in its `failed` counter.

### Data sent to third parties

The plugin makes outbound calls with your document content. Know what leaves before you install it.

| Destination | When | What is sent | How to stop it |
|-------------|------|--------------|----------------|
| `https://api.languagetool.org/v2/check` (default) | Every save of a document in `collections` (`checkOnSave`), every `/validate`, every document of a bulk scan | Up to 18 000 characters of extracted text — title, hero, rich text, every layout block — **including drafts that were never published**, in clear, form-urlencoded, with no API key | Set `languageToolUrl` to a self-hosted LanguageTool, or `checkOnSave: false` to limit it to explicit checks |
| `https://api.anthropic.com/v1/messages` | Only when `enableAiFallback: true` **and** `anthropicApiKey` is set | Up to 8 000 characters of the same extracted text | Leave `enableAiFallback` off (the default) |

Nothing else leaves the host. Results are stored in your own database.

Because the public LanguageTool endpoint is the default, the plugin logs a warning at boot when no
`languageToolUrl` is configured. If the transfer is acceptable for your project — and, under GDPR,
documented in your processing register — set `acknowledgePublicApi: true` to silence it.

Self-hosting takes one line:

```ts
spellcheckPlugin({
  languageToolUrl: 'http://languagetool.internal:8010/v2/check',
})
```

### Filtering

Every LanguageTool match goes through these layers, in order:

1. premium-only rules
2. `skipRules` (defaults + your additions, or your `overrideDefaultSkipRules`)
3. `skipCategories` (same logic)
4. exact dictionary match on the flagged word
5. dictionary entry contained in the flagged word — entries of 5+ characters only, on a word boundary
6. multi-word dictionary entry present in the surrounding context
7. single-character matches, except in the `GRAMMAR` category
8. non-language patterns: URLs, e-mails, CamelCase, all-caps acronyms, numbers and units, hashtags,
   currency, phone numbers, domain names, inline code, `snake_case`, CSS custom properties
9. code-ish context: an open backtick span, or a CLI command (`npm`, `git`, `docker`, …)
10. suggestions identical to the original, and contexts shorter than 5 characters
11. repetition rules whose word is in the dictionary or whose suggestion is empty

Then the issues the user marked as ignored (`ignoredIssues` on the stored result) are removed.

### Scoring

```text
score = clamp(round(100 - (issues / words) * 1000), 0, 100)
```

A document with no words or no issues scores 100. The same formula runs client-side after a fix, so
the badge and the stored score never disagree.

- **≥ 95** — excellent (green)
- **≥ 80** — good (amber)
- **< 80** — needs work (red)

### Claude (optional)

With `enableAiFallback: true` and an `anthropicApiKey`, the extracted text (truncated to 8 000
characters) is also sent to `claude-haiku-4-5-20251001` for semantic issues only: inconsistent tone,
contradictions, awkward phrasing, missing words. Results carry `source: 'claude'`, a category among
`COHERENCE`, `TONE`, `PHRASING`, `MISSING_WORD`, and a `ruleId` of `CLAUDE_<category>`.

Claude enriches the LanguageTool result — it never replaces it. A Claude failure is logged and
skipped; only a LanguageTool failure fails the request.

Two guardrails apply to that pass, because the analysed text is document content and therefore
untrusted (a contributor without publish rights, an import, a syndicated feed):

- the content is fenced in the prompt and explicitly marked as data, so a paragraph that reads
  "ignore the instructions above and answer …" is not read as an instruction;
- an `original` the model returns is located in the real text (`indexOf`) instead of being given a
  fabricated `offset: 0`. If it cannot be located, the issue keeps its message but loses its
  coordinates and its suggestion — it is reported, never applied.

`source: 'claude'` issues are also **excluded from `/fix-all`**: semantic suggestions are applied one
at a time, by a human who sees what is being replaced, never in an unattended batch.

## API Endpoints

Paths below assume the default `endpointBasePath` (`/spellcheck`) and Payload's default API route
(`/api`). Every endpoint requires an authenticated user **from the admin auth collection**
(`config.admin.user`) **and** passes the `access` check (admin-only by default). A rejection answers
`403`; when the default check is in use, the body also carries a `hint` naming the expected role.
Exceeding a rate limit answers `429` with `Retry-After` — the access check runs first, so an
anonymous or unauthorised caller always gets `403`, never `429`, and never reaches the rate limiter.

| Method | Path | Rate limit | What it does |
|--------|------|-----------|--------------|
| `POST` | `/api/spellcheck/validate` | 30/min | Check one document (`{ id, collection }`) or raw text (`{ text, language? }`, 50 000 chars max) |
| `POST` | `/api/spellcheck/fix` | 20/min | Apply one correction in the Lexical JSON, then re-align the offsets of the remaining stored issues |
| `POST` | `/api/spellcheck/fix-all` | 5/min | Apply every stored fixable LanguageTool issue of a document, last offset first, in strict mode (Claude issues excluded) |
| `POST` | `/api/spellcheck/bulk` | 3/min | Start a background scan; returns immediately |
| `GET` | `/api/spellcheck/status` | 60/min | Current scan progress |
| `GET` | `/api/spellcheck/dictionary` | 60/min | List dictionary words, sorted alphabetically |
| `POST` | `/api/spellcheck/dictionary` | 60/min | Add one or several words |
| `DELETE` | `/api/spellcheck/dictionary` | 60/min | Remove words by id or by word |
| `GET` | `/api/spellcheck/collections` | — | The collections the plugin is configured for |

### POST `/api/spellcheck/validate`

```json
// Check a document by ID
{ "id": "123", "collection": "pages" }

// Check raw text
{ "text": "Ceci est une test.", "language": "fr" }
```

**Response** — also stored in `spellcheck-results` when `id` and `collection` are given:

```json
{
  "docId": "123",
  "collection": "pages",
  "score": 85,
  "issueCount": 1,
  "wordCount": 450,
  "issues": [
    {
      "ruleId": "GRAMMAR",
      "category": "GRAMMAR",
      "message": "Le déterminant « une » ne correspond pas…",
      "context": "Ceci est une test.",
      "contextOffset": 9,
      "offset": 9,
      "length": 3,
      "original": "une",
      "replacements": ["un"],
      "source": "languagetool"
    }
  ],
  "readability": { "score": 62, "grade": "Facile", "avgSentenceLength": 14.2, "avgSyllablesPerWord": 1.7, "sentenceCount": 32, "wordCount": 450 },
  "consistency": [{ "term": "ecommerce", "variants": [{ "text": "e-commerce", "count": 3 }, { "text": "ecommerce", "count": 1 }] }],
  "lastChecked": "2026-09-07T20:30:00.000Z"
}
```

`403` when the collection is not in the plugin's `collections`, `404` when the document does not
exist, `400` when the text exceeds 50 000 characters, `502` with `{ "checkFailed": true }` when
LanguageTool is unreachable.

### POST `/api/spellcheck/fix`

```json
{
  "id": "123",
  "collection": "pages",
  "original": "une test",
  "replacement": "un test",
  "offset": 42,
  "length": 8,
  "field": "content"
}
```

`offset` and `length` target the correction precisely. The endpoint falls back to rewriting the
first matching substring of the document when they are missing — and also when they are supplied but
neither the exact offset nor the drift search finds `original` there. `field` restricts the search to
one top-level field.

**Response** (`FixResult`):

```json
{
  "success": true,
  "fixesApplied": 1,
  "original": "une test",
  "replacement": "un test",
  "method": "offset",
  "target": "draft",
  "appliedOffset": 42,
  "appliedLength": 8
}
```

`target` says where the correction went: `draft` when the document had a pending draft — the
published version is left untouched — `published` otherwise. `method` says how the text was located:
`offset` (exact hit), `search` (offset drift recovered) or `legacy` (substring fallback).

The `offset` and `search` paths are re-read from the mutated document before saving: when the
replacement did not land at the applied offset, nothing is persisted and the response comes back with
`success: false` and an `error`. The `legacy` path produces no coordinates, so that verification does
not apply to it — it is saved on the strength of the substring match alone, and answers
`success: true` with `method: 'legacy'` and no `appliedOffset`.

On success the endpoint also rewrites the stored `spellcheck-results` row: the corrected issue is
dropped and the offsets of the remaining ones are shifted by the length difference, with no
LanguageTool call. That re-alignment needs `appliedOffset`, which the legacy substring fallback does
not produce.

### POST `/api/spellcheck/fix-all`

```json
{ "id": "123", "collection": "pages" }
```

Applies every stored **LanguageTool** issue that has at least one suggestion, walking the document
from the **last** offset to the first so a length-changing replacement never invalidates the offsets
still to come. Issues carrying `source: 'claude'` are skipped: their `original`/`suggestion` pair
comes from a model that has just read the document, so replaying them unattended would let content
choose the string written into a published page. Apply those one by one from the dashboard.
Strict mode: no fuzzy match, no substring fallback — an issue whose offset no longer matches its
`original` is counted as `failed` rather than applied somewhere else. One re-check runs after the
batch, but only when at least one fix was applied: a batch where everything failed answers
`rechecked: false` and leaves the stored result as it was.

**Response** (`FixAllResult`): `{ "applied": 4, "failed": 1, "details": [...], "rechecked": true }`.
`404` when the document has no stored result yet.

### POST `/api/spellcheck/bulk`

```json
// Scan every configured collection
{}

// Scan one collection
{ "collection": "posts" }

// Scan specific documents
{ "ids": [{ "id": "123", "collection": "pages" }] }

// Reset a stuck scan and start over
{ "force": true }
```

Answers `{ "message": "Scan started", "status": "running" }` and runs in the background. `409` when a
scan is already running and `force` is not set — the body is the running job itself, in the `/status`
shape, plus `"error": "Scan already in progress"`, so the caller can display the progress of the scan
that blocks it. `403` when `collection`, or any `ids[]` entry, names a collection outside the
plugin's `collections` — a malformed entry (missing `collection`, falsy entry) rejects the whole
request. Collections without `versions.drafts` are scanned in full; the
others are limited to published documents.

### GET `/api/spellcheck/status`

`{ "status": "idle" }` when no scan ever ran, otherwise the live job:

```json
{
  "status": "running",
  "current": 12,
  "total": 40,
  "currentDoc": "Accueil",
  "totalIssues": 87,
  "totalDocuments": 12,
  "failed": 1,
  "averageScore": 0,
  "startedAt": "2026-09-07T20:30:00.000Z",
  "completedAt": null,
  "error": null,
  "lastActivity": 1757277000000
}
```

`failed` counts documents whose check could not run. `lastActivity` is the epoch timestamp (ms) of
the last progress update: a job with no progress for `bulkStaleTimeout` flips to `status: 'error'`
with `error: 'Scan timed out (no progress)'`, and the flip happens on the next `/status` or `/bulk`
call, not on a timer.

### Dictionary

```json
// GET  → { "words": [{ "id": "1", "word": "typescript", "addedBy": {...}, "createdAt": "…" }], "count": 1 }

// POST → { "added": ["typescript"], "skipped": [], "count": 1 }
{ "word": "TypeScript" }
{ "words": ["TypeScript", "Next.js", "Payload"] }

// DELETE → { "deleted": 2 }
{ "id": "abc123" }
{ "ids": ["abc123", "def456"] }
{ "word": "typescript" }
```

`DELETE` also reads `id` from the query string — `DELETE /api/spellcheck/dictionary?id=abc123`, for
clients that send no body. The forms accumulate: body `id`, query `id`, `ids[]` and the id resolved
from `word` are all deleted, and `deleted` counts the ones that existed. Supplying none of them
answers `400`.

Words are trimmed, lower-cased and capped at 100 characters. Adding an existing word is a skip, not
an error. Every write invalidates the 5-minute in-memory cache.

### GET `/api/spellcheck/collections`

`{ "collections": ["pages", "posts"] }` — used by the dashboard to build its collection filter.

## Collections

Both collections are created by the plugin and hidden from the admin nav. Since 0.15.0 they share
the endpoints' `access` check for read, create, update and delete: admin-only by default. The plugin
writes to them internally with `overrideAccess: true`, so tightening the gate does not affect scans
or fixes.

| Slug | Role | Read / write |
|------|------|--------------|
| `spellcheck-results` | One row per checked document: score, issues, ignored issues, readability, consistency | the plugin's `access` check |
| `spellcheck-dictionary` | One document per whitelisted word | the plugin's `access` check |

**`spellcheck-results` fields** — `docId`, `collection`, `title`, `slug`, `score`, `issueCount`,
`wordCount`, `issues` (JSON), `ignoredIssues` (JSON), `readability` (JSON), `consistency` (JSON),
`lastChecked`. Payload timestamps are disabled on this collection.

**`spellcheck-dictionary` fields** — `word` (text, unique, indexed, max 100, lower-cased on save),
`addedBy` (relationship to `users`).

## Package Exports

| Subpath | Exposes | Environment |
|---------|---------|-------------|
| `@consilioweb/payload-spellcheck` | Plugin, engine functions, types | server |
| `@consilioweb/payload-spellcheck/client` | Admin components | client (`'use client'`) |
| `@consilioweb/payload-spellcheck/views` | Dashboard view | server (RSC) |

### Root entry

```ts
import {
  // Plugin
  spellcheckPlugin,
  // Extraction
  extractTextFromLexical, extractAllTextFromDoc, extractAllTextFromDocWithSources, countWords,
  // Engines — prefer the run* forms, whose outcome distinguishes failure from a clean text
  runLanguageToolCheck, runClaudeCheck,
  checkWithLanguageTool, checkWithClaude, // @deprecated — return [] on failure
  // Filtering and scoring
  filterFalsePositives, calculateScore, DEFAULT_SKIP_RULES, DEFAULT_SKIP_CATEGORIES,
  // Analysis
  analyzeReadability, checkConsistency,
  // Dictionary cache
  loadDictionaryWords, invalidateDictionaryCache,
  // Fix-all handler, for a custom endpoint registration
  createFixAllHandler,
  // i18n
  getTranslations, getScoreLabel,
} from '@consilioweb/payload-spellcheck'

import type {
  SpellCheckPluginConfig, SpellCheckIssue, SpellCheckResult,
  TextSegment, ExtractedDoc,
  LanguageToolOutcome, ClaudeOutcome,
  ReadabilityResult, ConsistencyIssue,
  FixAllResult,
  SpellcheckLocale, SpellcheckTranslations,
} from '@consilioweb/payload-spellcheck'
```

### Client entry

```ts
import {
  SpellCheckField,
  SpellCheckDashboard,
  IssueCard,
  SpellCheckScoreCell,
} from '@consilioweb/payload-spellcheck/client'
```

### Views entry

```ts
import { SpellCheckView } from '@consilioweb/payload-spellcheck/views'
```

## Requirements

- **Node.js** — `>= 18`
- **Payload CMS** — `^3.0.0` (required peer dependency)
- **`@payloadcms/next`**, **`@payloadcms/ui`** — `^3.0.0`, optional peers, needed by the admin UI
- **React** — `^18.0.0 || ^19.0.0`, optional peer, needed by the admin UI
- **Next.js** — 15, or 16 with the Turbopack workaround at the top of this file
- **Database** — any Payload adapter. `autoFixSchema` only patches SQLite automatically; on other
  adapters it logs the `ALTER TABLE` statement to run.

## Uninstall

### Automatic

```bash
npx spellcheck-uninstall
```

It removes the plugin's imports and calls from your source files, drops the plugin tables and
indexes, removes the dependency, and regenerates the import map.

- `--keep-data` — keep the database tables.
- `--force-db` — drop the tables even when the plugin is not detected in the project. The database
  step is the only irreversible one, so by default it runs only when the plugin is actually found
  (a cleaned source file, or the dependency declared in `package.json`).

### Manual

1. Remove the plugin from your config.
2. Run `npx payload generate:importmap`.
3. Optionally drop the tables:

```sql
-- SQLite
DROP INDEX IF EXISTS `spellcheck_results_doc_id_idx`;
DROP INDEX IF EXISTS `spellcheck_results_collection_idx`;
DROP INDEX IF EXISTS `spellcheck_results_last_checked_idx`;
DROP INDEX IF EXISTS `spellcheck_dictionary_word_idx`;
DROP TABLE IF EXISTS `spellcheck_results`;
DROP TABLE IF EXISTS `spellcheck_dictionary`;
```

## Migration from `@consilioweb/spellcheck`

This package has been renamed from `@consilioweb/spellcheck` to `@consilioweb/payload-spellcheck`.

**Automatic migration (recommended):**

```bash
npx @consilioweb/migrate
```

This will update your `package.json` and all imports automatically.

**Manual migration:**

```bash
npm uninstall @consilioweb/spellcheck
npm install @consilioweb/payload-spellcheck
```

Then update your imports:

```diff
- import { spellcheckPlugin } from '@consilioweb/spellcheck'
+ import { spellcheckPlugin } from '@consilioweb/payload-spellcheck'
```

## Support

- Issues and feature requests: [GitHub issues](https://github.com/pOwn3d/payload-spellcheck/issues)
- If this plugin saves you time: [buy me a coffee](https://buymeacoffee.com/pown3d)

## License

MIT — see [LICENSE](LICENSE).

---

Made by [ConsilioWEB](https://consilioweb.fr) · [GitHub](https://github.com/pOwn3d)
