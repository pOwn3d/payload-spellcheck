# Changelog

All notable changes to `@consilioweb/payload-spellcheck` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.18.0] - 2026-09-08 — Ten controls with no name, and a badge that could blank a list view

Accessibility, resilience and documentation release. **Nothing here is a security fix** — 0.17.0
closed the last open item and no new hole was found. Take it if your admin panel answers to the
EAA / RGAA, if you run anything other than SQLite, or if you are about to migrate or uninstall.
Otherwise it can ride along with your next routine bump.

### Fixed

- **Ten form controls had no accessible name at all.** Every `<input>`, `<select>` and
  `<textarea>` the plugin renders — the collection filter, the two "select all" checkboxes, the
  per-row selection checkboxes in both tables, the dictionary add and search fields, the import
  `<textarea>`, and in `IssueCard` the replacement `<select>` and the manual-correction input —
  reached the accessibility tree as an unlabelled control. A screen reader announced "edit text,
  blank". None of them had a `<label>` to point at, so each is named with `aria-label`, reusing the
  visible wording where one existed (`IssueCard`'s replacement `<select>` takes the same
  "Suggestion" string as the `<span>` above it rather than inventing a second one) and naming the
  row it belongs to where it did not (`Sélectionner ${title}`, `Supprimer ${word}`). The
  dictionary's `✕` delete button, whose name was the glyph plus a `title`, now says which word it
  deletes.
- **Five sortable column headers were `<th onClick>`.** No role, no keyboard access, and no
  machine-readable sort state — the `↑` / `↓` glyph was the only cue, and only for people who can
  see it. The handler moved into a real `<button type="button">` inside the header, styled flat so
  the table looks unchanged, and the `<th>` carries `aria-sort`. Collection and Lisibilité are not
  sortable and deliberately declare none.
- **A `<tr onClick>` was the only way to expand a document's issues.** A table row is not a
  control; no keyboard user could reach it, and the two `stopPropagation()` calls that kept the row
  checkbox and the document link usable existed only to defuse it. The trigger is now a button in
  the "Problèmes" cell carrying `aria-expanded`, and the row went back to being a row — the
  tempting wrong fix, `<tr role="button" tabIndex={0}>`, would have severed the cells from their
  headers, and a test now refuses it.
- **The dashboard's two tabs signalled the selected one with colour and font weight only.** They
  now implement the ARIA tabs pattern in full: `role="tablist"`, `role="tab"` with `aria-selected`
  and `aria-controls`, `role="tabpanel"` regions with `aria-labelledby` (the panels were bare
  fragments), roving `tabIndex` so the tablist is one stop in the tab sequence, and Arrow / Home /
  End moving between tabs. Ids come from `useId()`, not from string literals — nothing stops a host
  from mounting the dashboard twice, and duplicate ids would break the very association these
  attributes create.
- **The focus ring is now pinned, not just intact.** The new flat button styles reset `background`,
  `border`, `padding` and `font` individually rather than with `all: unset`, which also resets
  `outline-style` to `none` as an author declaration and outranks the UA `:focus-visible` rule —
  it would have deleted the focus indicator on the exact controls this release exists to make
  reachable. Five tests, one per component source, fail on any `outline: 'none'` or `all: 'unset'`.

### Added

- **`AdminErrorBoundary` (`src/components/ErrorBoundary.tsx`), around all three of the plugin's
  mount points.** Payload mounts `Field`, `Cell` and view components straight from the import map,
  so the plugin has no ancestor of its own in the host's tree: an uncaught render error propagates
  to Payload's root and unmounts the whole screen. The radius, per mount point:
  - `SpellCheckScoreCell` renders **once per row of the list view of collections the plugin only
    decorates**. One malformed stored result took the host's entire listing down — their content
    unreachable because of a spellcheck badge. Wrapped with `fallback={null}`, so a failed badge
    looks like a missing badge instead of an error panel repeated on every row, and `resetKeys` on
    `[rowData.id, collectionSlug]` so a cell that failed for one document recovers when the table
    is sorted, filtered or paged onto another.
  - `SpellCheckField` renders in the **sidebar of every document of every scanned collection**. A
    throw unmounted the edit screen and locked the editor out of a document the plugin merely
    annotates. Also `fallback={null}`.
  - `SpellCheckView` is the full-page dashboard, and there a **visible** panel is the right call:
    degrading silently would leave an admin staring at an empty screen unable to tell a crash from
    an empty dictionary. `DefaultTemplate` — nav, breadcrumbs, logout — keeps working around it.
- **Why the view is wrapped from the inside, and why no `try/catch` was added on the server.**
  `SpellCheckView` is a server component that Payload mounts itself; nothing the plugin controls
  can wrap it from outside, and a client class cannot enclose a server component's body. So the
  boundary sits inside the view, around its client child, and is imported through
  `@consilioweb/payload-spellcheck/client` — already in tsup's `external` list — which is what
  keeps the class on the client side of the RSC split; a relative import would inline a stateful
  component with lifecycle methods into the server bundle. Its server body was left unguarded on
  purpose: what runs there is the auth check and two `redirect()` calls, and `redirect` works *by
  throwing*, so a `try/catch` around it would swallow the redirect it is meant to protect.
- **What the boundary does not catch, stated rather than assumed.** React boundaries catch errors
  thrown during render, in lifecycle methods and in constructors — not rejected promises inside
  `useEffect`, not errors from event handlers. The `fetch` calls in these components keep their own
  `catch`, which they already had.
- **The boundary itself is hardened past the version first shipped in `payload-support`**, and each
  difference is a test: `resetKeys` (an error used to latch until the page was reloaded, even once
  the offending document was gone), `fallback={null}` honoured with `!== undefined` rather than a
  truthiness check (a truthy test sends the list-view cell to the default red panel, once per row),
  the caught error deliberately kept out of state so nothing on screen can quote it — Payload
  messages routinely carry document titles, slugs and SQL fragments, and this panel can render in a
  list view a lower-privileged editor can open — and Retry remounting the subtree via a `key`
  instead of re-rendering the tree that just threw. Plus `role="alert"`, `--theme-*` tokens so the
  panel follows the host's theme, and its three strings in the plugin's own i18n.
- **55 tests, taking the suite from 85 to 140.**
  - `src/__tests__/accessibility.test.ts` — 26 tests, asserted on the component sources. This
    package declares `dependencies: {}` and tests in a `node` environment; pulling in jsdom and a
    testing library to check markup would trade a zero-dependency plugin for a lint a parser does
    just as well, and every fact checked is syntactic. They also count the controls, so the suite
    cannot go green by deleting them.
  - `src/__tests__/errorBoundary.test.ts` — 15 tests, exercising the real class through
    `getDerivedStateFromError`, `render()`, `componentDidUpdate` and the exported
    `resetKeysChanged` predicate. No renderer, no DOM. Each one fails against the earlier boundary.
  - `endpoints.test.ts` — 8 tests pinning that the `access` on `spellcheck-results` and
    `spellcheck-dictionary` grants exactly what `/spellcheck/validate` grants, across four callers
    (an admin of the admin collection, a non-admin, an *"admin" of a second auth collection* —
    the escalation 0.16.0 closed — and an anonymous one) and all four operations. The dashboard
    persists "ignore this issue" with a plain REST `PATCH` on the collection rather than through an
    endpoint; that is only defensible while the two gates are the same one, and these tests break
    if anyone loosens the collection.
  - `hardening.test.ts` — 6 tests pinning what `autoFixSchema` actually does per shape of database
    client: logs only against a libsql-shaped client, executes only against one exposing a
    synchronous `exec()`, swallows a duplicate-column error instead of warning on every boot, never
    fires the DDL on an unrelated failure (a refused Postgres connection), and, when opted out,
    installs no `onInit` at all while leaving the LanguageTool disclosure in place.

### Changed

- **Expanding a document's issues is now a click on the issue count, not anywhere on the row.**
  The rows lost their `cursor: pointer` accordingly. The count stays plain text for a document with
  no issues or one never checked. This is the one visible change in how the dashboard is used.
- **`SpellCheckField` and `SpellCheckScoreCell` now export the wrapped components.** Same props,
  same default export, same import paths — a consumer importing either sees no difference beyond
  the containment.
- **`@consilioweb/payload-spellcheck/client` gains `AdminErrorBoundary` and the
  `AdminErrorBoundaryProps` type**, and the component is added to the `bundle: false` entry list in
  `tsup.config.ts` — an entry missing there leaves a dangling `./ErrorBoundary.js` import in every
  component that wraps itself in it.
- **`SpellcheckTranslations` gains `errorBoundaryTitle`, `errorBoundaryHint` and
  `errorBoundaryRetry`, all optional.** Optional on purpose: a consumer who hand-builds the object
  against an earlier version still type-checks. Both shipped locales define them and the panel
  falls back to French if they are absent.
- **The README's description of `autoFixSchema` was wrong, and no code changed to make it right.**
  It promised the plugin "adds the missing `payload_locked_documents_rels` column automatically on
  SQLite". It does not, on any adapter in the supported peer range: executing the statement needs a
  raw client with a *synchronous* `exec()`, and `@payloadcms/db-sqlite` builds its client with
  `createClient` from `@libsql/client`, whose surface is `execute()` / `executeMultiple()`.
  PostgreSQL and MongoDB expose neither. On every supported setup the option **probes and logs**;
  the `exec()` branch survives only for a host wiring its own better-sqlite3-shaped client. It was
  deliberately not promoted to `execute()`: that would turn an inert probe into a plugin writing
  DDL to a table of Payload's *core*, outside the `payload-migrations` ledger, on every boot
  including production — `onInit` is not gated on `NODE_ENV` — after which a later `payload migrate`
  adding the same column fails on it. The trade-off belongs to the host, so the statement is logged
  for an operator to run knowingly. `autoFixSchema: false` skips the probe, and with it the
  `onInit` hook entirely.
- **New README section, "Database and upgrades".** The plugin adds collections to your config; it
  does not own your schema, and **Payload gives a plugin no way to ship migrations** —
  `payload migrate` reads one directory, the host's `payload.db.migrationDir`, resolved in the
  host's own cwd, so a migration file published inside an npm package is never discovered. Hence:
  `push` in development, `migrate:create` + `migrate` in production, never `push` there. No option
  of this plugin toggles the schema — `spellcheck-results` and `spellcheck-dictionary` appear as
  soon as the plugin is in `plugins`, whatever the options, and everything it injects into *your*
  collections (`_spellcheck`, `_spellcheckScore`) is `type: 'ui'` and creates no column, so growing
  the `collections` list never produces a migration either.
- **New README section, "Upgrading",** with the schema answer for 0.15.x → 0.16.0 → 0.17.0: **no
  schema change in either**, verified by diffing `src/collections` between `v0.15.0` and `HEAD` —
  the only change to either collection is the *type of the parameter* the access guard takes. Every
  release from here on states whether it moves the schema.
- **`npx spellcheck-uninstall` drops the tables on SQLite only — the README now says so.** The
  script looks for `*.db` files in the project root and in `data/`, then shells out to the `sqlite3`
  binary; on PostgreSQL and MongoDB it finds no such file, reports nothing, and leaves both tables
  in place. Source and dependency cleanup still runs correctly — only the data stays behind. The
  manual block is now split per adapter, PostgreSQL (`DROP … CASCADE`, plus the optional
  `payload_locked_documents_rels` columns) and MongoDB (`mongosh`, collections rather than tables),
  and all three now also clear the rows Payload's lock table keeps for the dropped documents, which
  the previous instructions left orphaned.
- **The dictionary's scope is documented, including where it does not fit.** `word` is
  `unique: true` across the whole Payload instance, so the dictionary is shared by every collection
  and every site that instance serves — which follows the one-instance-one-site model these plugins
  assume, but makes the plugin unusable per-tenant alongside `@payloadcms/plugin-multi-tenant`: two
  tenants cannot hold the same word with different intents, and the second insert fails on the
  unique index.
- **`SpellCheckResults.ts` records why the dashboard's "ignore" write is a plain REST `PATCH`** and
  not a dedicated endpoint: since 0.15.0 the collection's `access.update` *is* the endpoints'
  guard, and since 0.16.0 that guard also requires the caller to have authenticated against
  `config.admin.user`, so routing the write through an endpoint would move code without narrowing
  the set of accounts that can perform it. The note names the one thing an endpoint would add —
  field-level narrowing, since a `PATCH` can also rewrite `issues` — and the condition under which
  the decision must be re-opened.

## [0.17.0] - 2026-09-08 — The peer range still let you install a vulnerable Payload

Packaging release: no runtime code changed, `dist` behaves exactly as in 0.16.0. What changed is
the floor of the Payload this plugin will install against. Urgency depends on the version you
actually resolve, not on the one you declare — run `npm ls payload` (or `pnpm why payload`) before
deciding this can wait.

### Security

- **The declared peer range accepted a Payload carrying a pre-authentication account takeover.**
  `peerDependencies.payload` was `^3.0.0`, so every 3.x satisfied it — including the releases
  affected by GHSA-hp5w-3hxx-vmwf (pre-authentication account takeover) and by an SQL injection,
  both fixed in `3.79.1`. The hole was not in this plugin's code; the plugin is the amplifier. It
  runs its dashboard on Payload's own `initPageResult` and `DefaultTemplate` and writes documents
  through the Local API, so on a vulnerable core everything the plugin gates behind an admin
  account follows that account: the extracted text of every scanned document, drafts included, the
  dictionary, `/fix` and `/fix-all`. The floor now lives in the peer range, where a package manager
  refuses it, instead of in a README sentence no CI reads. **Every version ever published carried
  this range, 0.16.0 included** — that release tightened the plugin's own gates and left the core
  they stand on unconstrained. What to check on your side: the *resolved* version, not the range.
  An install created months ago can still be sitting on an early 3.x that this plugin happily
  accepted. If it is below `3.79.1`, upgrade Payload — updating this plugin alone changes nothing
  about the core already on disk.

- **The dashboard's own gate did not change, but one wiring is worth re-checking.** Since 0.16.0
  the view is gated by the same `isAllowed` the endpoints use — the check that compares
  `req.user.collection` with the admin auth collection — published by the plugin on
  `config.custom`. That entry only exists when the plugin registers the view. If you wired
  `SpellCheckView` in by hand, through the `@consilioweb/payload-spellcheck/views` import
  documented under "Views entry", without the plugin also sitting in your `plugins` array, the
  entry is absent and the view falls back, deliberately, to its older rule: any authenticated user
  gets in. Payload exempts custom admin views from `canAccessAdmin`, so nothing behind the view
  catches that for you. Confirm the plugin is in `plugins` and let it register the view.

### Breaking

- **`payload`, `@payloadcms/next` and `@payloadcms/ui` move from `^3.0.0` to `^3.79.1`.** An
  install resolving an older 3.x now fails outright on npm 7+ and on pnpm instead of resolving
  quietly; yarn warns. Installs between `3.44` and `3.79.0` do work at runtime and are exactly the
  ones this change is meant to lock out. Nothing here uses an API newer than `3.79.1`, so the range
  is a floor, not a rewrite of what the plugin supports.
- **The old range was also untrue, independently of the advisory.** The dashboard types itself with
  `AdminViewServerProps`, exported from `payload` only since `3.2x`, and passes a `req` prop to
  `DefaultTemplate` that `@payloadcms/next` only gained in `3.44`. A consumer who took `^3.0.0` at
  its word and installed Payload `3.1` got a plugin that could not render its own view. That
  mismatch is gone, not fixed — the declared floor now matches what the code actually calls.
- **`react` is untouched**: still `^18.0.0 || ^19.0.0`, still optional. Raising the Payload floor
  does not drop React 18.

### Added

- `src/__tests__/packaging.test.ts` — 5 tests, taking the suite from 80 to 85. It reads the shipped
  `package.json` and asserts that the caret floor of each of the three Payload peers is `>= 3.79.1`
  and stays on major 3, so widening the range back to `>=3` or `*` fails in CI rather than in the
  wild; that the `react` peer keeps both majors; and that `pnpm-lock.yaml`'s importers block records
  the same specifiers as `package.json` — a peer bump committed without re-running `pnpm install`
  otherwise reaches CI as `ERR_PNPM_OUTDATED_LOCKFILE` on `--frozen-lockfile`.

### Changed

- README states `^3.79.1` in the peer table and in **Requirements**, with the reasoning inline: the
  advisory floor on one side, the `AdminViewServerProps` / `DefaultTemplate` `req` requirements on
  the other.
- `pnpm-lock.yaml` re-recorded against the new specifiers. The versions it resolves are unchanged.

## [0.16.0] - 2026-09-08 — A token from any auth collection was a spellcheck token

Security release. 0.15.0 and every earlier version ship the holes this one closes.
Read `### Security` to judge whether you were exposed, then `### Changed` for the
accounts that lose access on the way.

### Security

- **Any account authenticated against any auth collection could reach the whole
  plugin.** The gate was `!!req.user` plus the project's `access` function. On an
  install with a second auth collection — `customers`, `members`, `partners`, the
  norm on an e-commerce or multi-tenant site — those accounts carry a
  `payload-token` too, and one holding `role: 'admin'` **inside its own
  collection** satisfied the default check. That opened the nine
  `/api/spellcheck/*` endpoints and both plugin collections: reading the
  extracted text of every scanned document (drafts and never-published edits
  included) through `spellcheck-results`, writing arbitrary `issues` into it, and
  calling `/fix` and `/fix-all`, which write into published documents with
  `overrideAccess: true`. The guard now also compares `req.user.collection` with
  the collection backing the admin panel (`config.admin.user`), and it runs
  **before** the configured `access` function — so an install that shipped
  `access: (req) => Boolean(req.user)`, the snippet this README and the 0.15.0
  migration note both recommended, is covered as well. If your project has more
  than one auth collection, audit `spellcheck-results` for `issues` you did not
  produce and the revision history of your scanned collections. Not covered: a
  custom auth strategy that leaves `collection` off the user object, and user
  objects built in host code for the Local API — HTTP authentication always sets
  it.

- **Document content was concatenated into the Claude prompt as instructions.**
  The analysed text went in raw after a `Text:` label, so a paragraph phrased as
  an instruction was read as one and could steer what the model returned as
  issues and suggestions. The author of that text is anyone who can get content
  into a scanned document — a contributor without publish rights, an import, a
  syndicated feed. The content is now fenced in `<document_to_proofread>` tags
  and declared as data, and any spelling of that tag is stripped from the content
  before it goes in. Affects installs running `enableAiFallback: true` with an
  `anthropicApiKey`; the LanguageTool path was never involved.

- **A Claude suggestion could be written into a published document at a position
  nobody computed.** Every Claude issue was stored with a hard-coded `offset: 0`
  — the very start of the document. `/fix-all` walked those offsets and applied
  the model's `suggestion` there, onto the title; on the single-fix path the
  offset did not match, and the substring fallback applied it somewhere else
  entirely. Chained with the injection above, document content could choose the
  string written into a published page under one admin click on "fix
  everything". Three changes: the real position is now located in the analysed
  text; an `original` the model invented gets no coordinates and no replacement,
  so it stays a readable remark and never an applicable edit; and `source:
  'claude'` issues are excluded from `/fix-all` altogether (see `### Changed`).

- **The rate limiter ran before authentication and keyed on a caller-supplied
  header.** Two abuses, both available to an anonymous caller. One entry was
  created in the limiter's Map per distinct `X-Forwarded-For` value, per limiter,
  with no ceiling and a cleanup that only ran every five minutes — memory grew
  with forged values. And a forged header carrying a known admin's address filled
  that admin's bucket, denying them `/validate`, `/fix` or `/bulk`. The access
  check now runs first, so an unauthenticated caller is answered `403` without
  ever reaching the limiter, and the limiter keys on `user.collection:user.id`
  instead of the IP. Each limiter also enforces a hard 5 000-key ceiling with
  least-recently-seen eviction.

- **A bulk scan loaded every matching document into memory at once.** The scan
  ran `payload.find({ limit: 0 })` — no limit — per collection and held every
  document, full Lexical trees included, for the whole run, plus every
  `SpellCheckResult` it produced. With the 3 s pause between documents that is
  roughly `docs × 3 s` of residency: about 50 minutes on a thousand pages. Any
  caller who could reach `/bulk` — which, before the access fix above, included
  every front-office account — could exhaust the Node process with a single
  request. The scan now pages 200 documents at a time, drops each page before
  fetching the next, and keeps a running average instead of the results.

- **The public LanguageTool API is the default destination for your content, and
  nothing said so.** With no `languageToolUrl` set, up to 18 000 characters of
  extracted text — title, hero, rich text, every layout block, **drafts
  included** — are POSTed in clear to `https://api.languagetool.org/v2/check` on
  every save of a scanned collection (`checkOnSave`, on by default), on every
  `/validate`, and for every document of a bulk scan. The transfer itself is
  unchanged: turning it into an opt-in would break every existing install, and
  that is a major-version decision. What changes is that the plugin now warns
  about it at boot, and the README documents every outbound call under "Data sent
  to third parties". Point `languageToolUrl` at a self-hosted LanguageTool to
  stop the transfer, or set `acknowledgePublicApi: true` to acknowledge it and
  mute the warning.

- **Release pipeline.** The GitHub Actions used by the CI and npm publish
  workflows are pinned to commit SHAs instead of floating `v4` tags, so a moved
  tag can no longer change what builds and publishes this package.

### Fixed

- A bulk scan no longer stops silently after the first 200 documents when
  `payload.find` returns no `hasNextPage` — paging also ends on a short or empty
  page. Pages are ordered by `id`, so a document saved mid-scan is neither
  skipped nor scanned twice.
- Scan progress no longer reads `x / NaN` for the rest of a run when a collection
  query answers without a numeric `totalDocs`: a non-finite count contributes 0
  to the total instead of poisoning it.
- A malformed Claude response no longer discards the entire Claude pass. A
  payload that is not an array, or an item without a string `original`, used to
  throw inside the parser and be reported as a failed check; non-conforming items
  are now dropped and the rest is kept.

### Changed

- **Accounts outside the admin auth collection lose every access they had.** This
  is the visible face of the first `### Security` item, and it is not
  configurable: the collection check runs before your `access` function, so a
  project that deliberately opened the plugin to a second auth collection can no
  longer do so. Symptoms after updating: `403` on the endpoints, an empty sidebar
  score and an empty dashboard table, and `403` on REST reads of
  `spellcheck-results` and `spellcheck-dictionary`.
- **`/fix-all` skips `source: 'claude'` issues.** They remain visible in the
  dashboard and applicable one at a time through `/fix`, where a human sees what
  is being replaced. If `enableAiFallback` is on, expect lower `fixed` counts, and
  a document whose only issues are semantic now answers "nothing to fix".
- **An unauthorised caller gets `403`, never `429`.** The access check moved ahead
  of the rate limiter, so a client that distinguished the two status codes sees
  the rejection change shape.
- **Rate limits are counted per account instead of per IP.** Several admins behind
  one address no longer share a bucket; conversely, one account calling from
  several addresses now shares a single one. `trustProxy` still exists but now
  only affects the fallback bucket, used when a request somehow reaches the
  limiter without an account id.
- **A warning is logged at boot** when no `languageToolUrl` is configured. If your
  alerting watches `logger.warn`, it will fire on every start until you set
  `languageToolUrl` or `acknowledgePublicApi: true`.

### Added

- `maxDocs` — upper bound on the number of documents a single bulk scan
  processes. Unset means no cap, which is the previous behaviour.
- `acknowledgePublicApi` — acknowledges the transfer to the public LanguageTool
  API and silences the boot warning.

## [0.15.0] - 2026-09-07 — It reports the misspellings, and it stops corrupting what it corrects

Spelling detection was switched back on, silent content corruption is now refused
instead of reported as a success, and a failed check is no longer stored as a
perfect score. Several defaults change: read `### Breaking` before updating.

### Breaking

- **Spelling mistakes are reported again.** `'TYPOS'` (the LanguageTool category
  carrying every misspelling, English and French) left `DEFAULT_SKIP_CATEGORIES`,
  and `'MORFOLOGIK_RULE_FR_FR'` left `DEFAULT_SKIP_RULES`. Documents that scored
  100/100 will now surface real issues and their scores will drop — that is the
  point, but it lands on your dashboard the moment you update. To restore the old
  behaviour: `skipCategories: ['TYPOS'], skipRules: ['MORFOLOGIK_RULE_FR_FR']`.
  Prefer adding your proper nouns to `customDictionary` instead.

- **The two plugin collections now use the plugin's `access` function.**
  `spellcheck-results` and `spellcheck-dictionary` moved from
  `({ req }) => !!req.user` to the same admin-only gate as the endpoints (see
  `### Security`). Any authenticated non-admin loses REST read/write: the sidebar
  score and the dashboard table render empty for them. On a Payload install whose
  `Users` collection has no `role` / `roles` field, *nothing* is readable any
  more. Migration: add the field, or pass your own check —
  `spellcheckPlugin({ access: (req) => Boolean(req.user) })`.

- **`POST /api/spellcheck/validate` answers `502` with `{ checkFailed: true }`**
  when LanguageTool is unreachable (429, timeout, 5xx, DNS), where it used to
  answer `200` with `score: 100, issueCount: 0`. Nothing is written to
  `spellcheck-results` in that case. The `afterChange` hook takes the same path
  silently (`logger.warn`, stored result left untouched), and a bulk scan counts
  the document in the new `failed` counter instead of overwriting its result.
  Clients that assumed a 2xx must now handle 502.

- **`POST /api/spellcheck/bulk` answers `403 { error: 'Collection not allowed' }`**
  when `collection` names a collection outside the plugin's configured
  `collections`, and when *any* entry of `ids[]` is falsy, carries no
  `collection` string, or names an undeclared collection (see `### Security`).
  The check on `ids[]` is stricter than a plain allowlist: a malformed entry such
  as `ids: [{ id: 42 }]` used to be dropped silently by the per-collection filter
  and now rejects the whole request. Add the collections you scan to
  `collections`, and give every `ids[]` entry an explicit `collection`.

- **`POST /api/spellcheck/fix` writes into the draft when one is pending.** The
  document is read with `draft: true` for offset alignment; the write back now
  mirrors that (`draft: true` when `doc._status === 'draft'`) instead of saving
  the draft content onto the main row — which made the published page disappear
  and the rest of the draft overwrite what was online. `FixResult` gains
  `target: 'draft' | 'published'`.

- **`applyFix` no longer persists a correction it cannot verify.** Two guards,
  on two different paths. (1) A span reaching past its text node is refused
  (`slice()` used to clamp it, replacing less than intended and leaving the tail
  of the match behind in the following node — a duplicated word). (2) On the
  `offset` and `search` paths *only*, the text is re-extracted after the in-place
  mutation and the write is dropped unless the replacement really landed at the
  requested offset: the call returns `success: false` with
  `error: 'Fix verification failed — document left untouched'`. Neither guard
  makes `/fix` refuse an inter-node span outright — that is `/fix-all`'s strict
  mode (next bullet). Outside strict mode a refused span still falls through to
  `legacyFixSubstring()`, which rewrites the first occurrence in the field and
  succeeds with `method: 'legacy'`; it carries no coordinates, so the
  verification above does not apply to it. Only when that fallback fails too does
  the call return `success: false` — and then with
  `error: 'Could not locate the text to fix'`.

- **`POST /api/spellcheck/fix-all` runs in strict mode.** `applyFix` gained a
  `strict` option, which fix-all sets: no `findClosestMatch` fallback, no
  substring fallback. An issue whose stored offset no longer matches its
  `original` is counted in `failed` rather than applied to some other occurrence
  of the word in a batch nobody reviews. `applied` can therefore be lower than in
  0.14.0. Single-document `/fix` keeps both fallbacks.

- **The `afterChange` hook no longer runs on autosave ticks, nor on the plugin's
  own writes.** It exits on `context.skipSpellcheck` (set by `/fix` and
  `/fix-all`) and on `req.query.autosave`. If you relied on a re-check at every
  autosave, you lose it — that path shipped up to 18 000 characters to
  LanguageTool on every keystroke burst. The stored result stays current all the
  same in the ordinary case: `/fix` re-aligns the remaining offsets
  arithmetically whenever it knows where it wrote (see `### Changed` for the one
  path where it does not), and `/fix-all` runs one re-check after its batch
  (reported as `rechecked` in `FixAllResult`).

- **Bulk scan on a collection without `versions.drafts`:** the
  `_status: { equals: 'published' }` filter and `draft: true` are no longer sent
  there, so *every* document of such a collection is scanned. Previously the query
  threw a `QueryError` and flipped the whole scan to `status: 'error'` with zero
  documents processed. Collections with drafts are unaffected.

- **`TextSegment` gains a required `leadingTrim: number`.** The type is exported
  from the package root, so anyone constructing a segment by hand must supply it
  (`0` for title and plain-text segments). Reading segments is unaffected.

- **`trustProxy` now actually does something, and defaults to `true`.** The option
  was documented in three places but never read: `getClientIp()` always trusted
  `x-forwarded-for` / `x-real-ip`. The README announced a default of `false`, so
  anyone who set `trustProxy: false` believing it was in effect now really gets
  it — a single global rate-limit bucket shared by every caller, exhaustible by
  an anonymous request since the limiter runs before authentication. Set
  `trustProxy: true`, or drop the option, to keep 0.14.0's effective behaviour.

- **`npx spellcheck-uninstall` now uninstalls, and no longer drops tables
  blindly.** `PACKAGE_NAME` was hardcoded to `@consilioweb/spellcheck`, so every
  `includes(PACKAGE_NAME)` check matched nothing: no import, no plugin call and no
  dependency was ever removed — yet `DROP TABLE spellcheck_results` /
  `spellcheck_dictionary` ran unconditionally on every `.db` found, and the script
  printed "Uninstall complete!". The name is now read from the package's own
  `package.json`, so the source cleanup and the dependency removal really happen
  (users accustomed to the script's inaction will see their code edited), and the
  irreversible database step runs only when the plugin is actually detected — a
  cleaned source file, or the dependency declared in `package.json`. Use
  `--force-db` to drop the tables anyway.

- **`npx spellcheck-install` no longer injects `skipRules: ['FR_SPELLING_RULE',
  'WHITESPACE_RULE'], skipCategories: ['TYPOGRAPHY', 'STYLE']`** into the
  generated config: the first entry disabled French spelling, i.e. the feature
  being installed. The generated import now points at
  `@consilioweb/payload-spellcheck` instead of the deprecated gateway package.

### Security

- **Privilege escalation through `spellcheck-results`.** The collection was
  readable and writable by *any* authenticated account — including a front-office
  user with no admin access — because `admin: { hidden: true }` only hides the UI,
  not the REST API. Such an account could read the titles, slugs and text excerpts
  of unpublished drafts, then write arbitrary `issues` into the row and wait for an
  admin to click "fix everything", which applied that text to a published document
  with `overrideAccess: true`. Both plugin collections now share the endpoints'
  access check, resolved once in the new `src/endpoints/access.ts`.

- **`/api/spellcheck/bulk` accepted any collection.** It was the one endpoint the
  0.13.0 hardening missed: `collection` and `ids[].collection` went straight into
  `payload.find({ overrideAccess: true })`, so an allowed caller could scan a
  collection outside the configured list and ship its text to
  `api.languagetool.org`. Both are now checked against the plugin's `collections`.

### Added

- `overrideDefaultSkipRules` / `overrideDefaultSkipCategories` — replace the
  built-in skip lists instead of stacking on top of them (`skipRules` /
  `skipCategories` remain additive on top of the result). `[]` disables default
  filtering entirely. `DEFAULT_SKIP_RULES` and `DEFAULT_SKIP_CATEGORIES` are now
  exported so a list can be derived from the defaults.
- `trustProxy?: boolean` in `SpellCheckPluginConfig` (default `true`) — the
  option the README already described, now read by the rate limiter.
- `rateLimits.status` (default `60`/window) — `/status` has its own budget.
- `runLanguageToolCheck()` and `runClaudeCheck()`, returning the discriminated
  `LanguageToolOutcome` / `ClaudeOutcome` (`{ ok: true, issues }` |
  `{ ok: false, reason }`); both functions and both types are exported from the
  package root. They replace `checkWithLanguageTool()` / `checkWithClaude()` (see
  `### Deprecated`).
- Additive response fields: `failed` in the `/status` payload, `rechecked` in
  `FixAllResult`, `target` / `appliedOffset` / `appliedLength` in `FixResult`, and
  a `hint` in `403` bodies naming the expected role (only when the default access
  check is in use — a custom `access` gets a bare 403).
- `config.custom.spellcheck.isAllowed` — the resolved access check, published so
  the server-rendered dashboard view can gate itself like the endpoints. Existing
  `config.custom` keys are merged, not overwritten.
- Test suite for what actually writes, fixes and gates: `src/__tests__/fixCore.test.ts`,
  `endpoints.test.ts` and `pipeline.test.ts`, plus regression tests on the default
  skip lists in `engine.test.ts`.

### Changed

- `/fix` now rewrites the stored `spellcheck-results` row itself when it knows
  where it wrote: the corrected issue is dropped and the offsets of the remaining
  ones are shifted by the length delta (`src/utils/realignIssues.ts`), with no
  LanguageTool call. The re-alignment is gated on `appliedOffset`, which the
  `offset` and `search` paths set and the legacy substring fallback does not — a
  fix applied through that fallback still succeeds, but the offsets stored for
  that document keep describing the pre-correction text until the next check. The
  sidebar field correspondingly stopped `PATCH`ing `/api/spellcheck-results/:id`
  on the fix path — sending its own list back put the stale offsets straight into
  the database — so on the legacy path nothing re-aligns them. The ignore path
  still persists from the client.
- The `/admin/spellcheck` view redirects unauthorized users to `/admin` instead of
  rendering a dashboard whose every request answers 403. Registered without the
  plugin (or against an older config), it falls back to "authenticated is enough".
- A Claude failure no longer invalidates `/validate`: the fallback only enriches
  the LanguageTool result, so it is logged and skipped rather than failing the
  request. Only a LanguageTool failure produces the 502 above.
- Bulk scan isolates each collection in its own `try`/`catch`: a failing
  collection is logged and skipped instead of aborting the whole scan.
- The dashboard retries its document listing without the `_status` filter when the
  first request fails, and logs the failure instead of swallowing it in an empty
  `catch`.
- The dashboard backs off on a `429` from `/status`, honouring `Retry-After`, and
  checks `res.ok` before parsing the response on mount — a 429 body used to be
  read as "no scan running".
- README: documented the admin-role prerequisite in the Quick Start, corrected the
  `access` example signature (the whole request is the argument — `(req) => …`,
  not `({ req }) => …`, which crashed every endpoint with a 500), and documented
  the real `trustProxy` default.

### Deprecated

- `checkWithLanguageTool()` and `checkWithClaude()`. Both keep their signature,
  their behaviour and their export from the package root; they are only marked
  `@deprecated`. They return `[]` when the call fails, which cannot be told apart
  from "the text is clean" — the ambiguity that turned a LanguageTool outage into
  a score of 100. Move to `runLanguageToolCheck()` / `runClaudeCheck()`, whose
  `{ ok: false, reason }` says so.

### Fixed

- **"Fix all" corrected one issue and missed the rest.** Every offset is computed
  on the pre-correction text while `applyFix` re-reads the document at each
  iteration, so the first length-changing replacement — the norm in French —
  shifted every later offset. The batch now walks the document from the last
  offset to the first, which leaves the remaining (lower) offsets valid. Before
  strict mode, those drifted offsets were silently absorbed by the fallbacks and
  applied elsewhere in the document.
- **Corrections landed a few characters early in Lexical fields.** Extraction
  trims the text while the fix path walks the raw tree, so a leading empty
  paragraph or any leading whitespace shifted every offset in that field —
  correcting "lemonde" into "le monde" in "Bonjour lemonde" produced
  "Bonjourle mondee". `TextSegment.leadingTrim`
  records what the trim removed and `applyFixAtOffset` adds it back.
- **Duplicate rows in `spellcheck-results`.** The upsert is a find-then-create
  with no unique constraint on `(docId, collection)`, so two concurrent checks of
  the same document — the hook racing a manual `/validate`, or a bulk scan racing
  a save — both saw "no row" and both created one, and the dashboard listed the
  document twice. Writes are now serialised per `(collection, docId)`.
- **The dashboard hung on "scan in progress" over stale results.** `/status`
  shared the `/bulk` limiter (3 req/min) while being polled every 2 s: the budget
  was gone in ~6 s, the `completed` transition was never seen and the results
  table was never reloaded.
- **Engine failures left no trace.** `req.payload.logger` was never passed to the
  engine calls, so every `logger?.error` was a no-op; the four call sites now pass
  it.
- `cleanDatabase()` in the uninstall script reported "Cleaned" even when `sqlite3`
  was missing, because the helper it used returned `''` on failure as well as on
  success. It now checks the exit code.

## [0.14.0] - 2026-08-08 — Le dictionnaire ne bâillonne plus le correcteur

### Fixed
- **Une entrée de 2 ou 3 lettres étouffait des classes entières de fautes.** Le filtre du
  dictionnaire personnalisé comparait dans les DEUX sens et sans longueur minimale :
  `lower.includes(word) || word.includes(lower)`. Le sens inverse faisait écarter tout
  signalement portant sur un *fragment* d'une entrée — « API » au dictionnaire rendait « ap »,
  « pi » et « api » intouchables, y compris comme vraies fautes sans rapport. Et sans seuil,
  une entrée courte est contenue dans une multitude de mots français : elle les rendait tous
  invisibles. Un correcteur qui se tait à tort est pire qu'un correcteur absent — on le croit,
  et on publie. Ne subsiste que le sens utile (le mot signalé *contient* une entrée), avec un
  seuil de 5 caractères et une correspondance sur frontière de mot : « api » ne couvre plus
  « apiculture ». La correspondance exacte couvrait déjà le reste.
- **Nom de paquet corrigé dans les imports générés** : `@consilioweb/spellcheck` →
  `@consilioweb/payload-spellcheck`. Le plugin produisait des chemins d'import vers un paquet
  qui n'existe pas sous ce nom, dans `plugin.ts`, `types.ts` et la configuration de build.

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

[0.18.0]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.16.0...v0.17.0
[0.13.0]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.11.0...v0.13.0
[0.11.0]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/pOwn3d/payload-spellcheck/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/pOwn3d/payload-spellcheck/releases/tag/v0.10.0
