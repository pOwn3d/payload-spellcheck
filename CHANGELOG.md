# Changelog

All notable changes to `@consilioweb/spellcheck` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2026-04-08

### Added
- RBAC with configurable `access` function in plugin config
- `packageName` option for custom package name in component paths
- `upsertResult` shared utility (deduplicated from 3 files)
- `filterIgnoredIssues` shared utility (deduplicated from 3 files)
- `useSpellcheckI18n` hook for component localization
- i18n integration in SpellCheckField and IssueCard components
- Client-side score cache (30s TTL) in SpellCheckScoreCell
- Rate limiting on /status endpoint
- Collection injection protection on validate, fix, fixAll endpoints
- IP spoofing protection with `trustProxy` option
- Words array validation in dictionary endpoint
- Score formula alignment between client and server

### Changed
- fixAll calls fix logic directly instead of HTTP self-fetch (eliminates SSRF)
- SSRF fix: URL built from NEXT_PUBLIC_SERVER_URL, not Origin header
- console.error uses [spellcheck] prefix in engine modules

## [0.11.0] - 2026-03-12

### Added
- Rate limiting with `Retry-After` header on 429 responses
- Input validation on `validate` (collection/id), `fix` (collection/id), `dictionary` POST (word trimming), `dictionary` DELETE (word-based lookup support)
- `src/utils/rateLimiter.ts` — shared in-memory rate limiter with auto-cleanup

### Changed
- Replaced all `console.log/warn/error` with `req.payload.logger` across 6 endpoint files and 1 hook (standalone utilities without payload context kept as console)
- Adjusted rate limits: `fix` 60 → 20/min, `fixAll` 10 → 5/min, `bulk` 5 → 3/min
- Error handling in all endpoint catch blocks now extracts actual error message and logs via `payload.logger`

### Fixed
- `bulk.ts` line 288: Fixed duplicate `error` property in spread (pre-existing TS issue)
- Dictionary DELETE now supports deletion by word (not just by ID)

## [0.10.1] - 2026-03-11

### Fixed
- Schema auto-fix for `spellcheck_dictionary_id` column in `payload_locked_documents_rels`

## [0.10.0] - 2026-03-10

### Added
- Initial public release
- LanguageTool integration for spell checking
- Claude AI semantic fallback (optional)
- Custom dictionary with per-project words
- Bulk scan with async progress tracking
- Auto-fix with replacement suggestions
- Readability analysis (Flesch/Gunning Fog scores)
- Consistency checker (style variant detection)
- Admin dashboard view (`/admin/spellcheck`)
- Sidebar field for real-time spell check
- 9 REST API endpoints
- Rate limiting (30/min validate, 60/min dictionary)
- Score 0-100 per document
- CSV-compatible results
- TypeScript strict mode, full type exports

[0.13.0]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.11.0...v0.13.0
[0.11.0]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/pOwn3d/payload-spellcheck/releases/tag/v0.10.0
