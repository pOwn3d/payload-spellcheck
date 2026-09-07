#!/usr/bin/env node

/**
 * Full uninstall for this package (name read from its own package.json)
 * Removes all imports, plugin calls, DB tables, and the package itself.
 *
 * Usage: npx spellcheck-uninstall
 *   or:  npx spellcheck-uninstall --keep-data  (skip DB cleanup)
 *   or:  npx spellcheck-uninstall --force-db   (drop tables even if the plugin
 *                                               is not detected in this project)
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

/**
 * Read our own package name instead of hardcoding it. The literal used to be
 * '@consilioweb/spellcheck' (the deprecated gateway package), so every
 * `content.includes(PACKAGE_NAME)` check silently matched nothing: the
 * uninstaller cleaned no source file and removed no dependency, yet still ran
 * the irreversible DROP TABLE step. Deriving the name keeps the two in sync.
 */
function readOwnPackageName() {
  try {
    const pkgPath = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name
  } catch {
    // fall through to the literal below
  }
  return '@consilioweb/payload-spellcheck'
}

const PACKAGE_NAME = readOwnPackageName()

/** Escape a string for safe inclusion in a RegExp source */
function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Tables and indexes created by the plugin
const DB_TABLES = ['spellcheck_results', 'spellcheck_dictionary']
const DB_INDEXES = [
  'spellcheck_results_doc_id_idx',
  'spellcheck_results_collection_idx',
  'spellcheck_results_last_checked_idx',
  'spellcheck_dictionary_word_idx',
]

// Regex to match any import line from this package (built from PACKAGE_NAME)
const IMPORT_RE = new RegExp(
  `^\\s*import\\s+(?:type\\s+)?(?:\\{[^}]*\\}|[\\w]+)\\s+from\\s+['"]${escapeRe(PACKAGE_NAME)}(?:\\/[^'"]*)?['"]\\s*;?\\s*$`,
  'gm',
)

// ── Helpers ──────────────────────────────────────────────

function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun'
  return 'npm'
}

function run(cmd, cwd) {
  console.log(`  \x1b[90m$ ${cmd}\x1b[0m`)
  try {
    execSync(cmd, { cwd, stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

function runSilent(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

function findSourceFiles(dir) {
  const results = []
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      results.push(...findSourceFiles(fullPath))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Extract imported names from this package's imports.
 * Built from PACKAGE_NAME — it used to hardcode the deprecated gateway name,
 * so no imported symbol was ever collected and no plugin call was removed.
 */
function extractImportedNames(content) {
  const names = []
  const re = new RegExp(
    `^\\s*import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]${escapeRe(PACKAGE_NAME)}(?:\\/[^'"]*)?['"]\\s*;?\\s*$`,
    'gm',
  )
  let match
  while ((match = re.exec(content)) !== null) {
    for (const spec of match[1].split(',')) {
      const trimmed = spec.trim()
      if (!trimmed) continue
      const asParts = trimmed.split(/\s+as\s+/)
      names.push(asParts.length > 1 ? asParts[1].trim() : trimmed)
    }
  }
  return names
}

/**
 * Remove plugin calls (handles nested braces/parens across multiple lines)
 */
function removePluginCalls(content, callNames) {
  let modified = content

  for (const fnName of callNames) {
    let searchFrom = 0
    while (true) {
      const callIndex = modified.indexOf(`${fnName}(`, searchFrom)
      if (callIndex === -1) break

      // Verify not part of a larger identifier
      if (callIndex > 0 && /[\w$]/.test(modified[callIndex - 1])) {
        searchFrom = callIndex + fnName.length
        continue
      }

      // Find line start
      let lineStart = callIndex
      while (lineStart > 0 && modified[lineStart - 1] !== '\n') lineStart--

      // Find matching closing paren
      const openParen = callIndex + fnName.length
      let depth = 0
      let endIndex = openParen
      for (let i = openParen; i < modified.length; i++) {
        if (modified[i] === '(') depth++
        else if (modified[i] === ')') {
          depth--
          if (depth === 0) {
            endIndex = i + 1
            break
          }
        }
      }

      // Handle trailing comma
      let removeEnd = endIndex
      const afterCall = modified.slice(endIndex)
      const trailingMatch = afterCall.match(/^\s*,/)
      if (trailingMatch) {
        removeEnd = endIndex + trailingMatch[0].length
      }

      // Determine full range
      let removeStart = lineStart
      if (removeStart > 0 && modified[removeStart - 1] === '\n') removeStart--

      // If no trailing comma, try removing leading comma
      if (!trailingMatch) {
        let lookBack = removeStart
        while (lookBack > 0 && /[\s\n]/.test(modified[lookBack - 1])) lookBack--
        if (lookBack > 0 && modified[lookBack - 1] === ',') removeStart = lookBack - 1
      }

      modified = modified.slice(0, removeStart) + modified.slice(removeEnd)
    }
  }

  return modified
}

function cleanEmptyLines(content) {
  return content.replace(/\n{3,}/g, '\n\n')
}

function cleanOrphanCommas(content) {
  return content.replace(/,(\s*\n\s*[)\]])/g, '$1')
}

/**
 * Process a single source file: remove imports and plugin calls
 */
function processFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf-8')
  if (!original.includes(PACKAGE_NAME)) return null

  let content = original

  // Extract names before removing imports
  const importedNames = extractImportedNames(content)

  // Remove import lines
  content = content.replace(IMPORT_RE, '')

  // Remove plugin calls
  if (importedNames.length > 0) {
    content = removePluginCalls(content, importedNames)
  }

  // Also remove any admin-nav items referencing /admin/spellcheck
  content = content.replace(/\s*\{[^}]*href:\s*['"]\/admin\/spellcheck['"][^}]*\},?\s*/g, '')

  // Clean up
  content = cleanOrphanCommas(content)
  content = cleanEmptyLines(content)

  return content === original ? null : content
}

/**
 * Check whether the host project declares this package as a dependency.
 * Used as evidence that the plugin is really installed here.
 */
function isDeclaredDependency(projectDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'))
    return Boolean(
      pkg.dependencies?.[PACKAGE_NAME] ||
      pkg.devDependencies?.[PACKAGE_NAME] ||
      pkg.peerDependencies?.[PACKAGE_NAME] ||
      pkg.optionalDependencies?.[PACKAGE_NAME],
    )
  } catch {
    return false
  }
}

/**
 * Find SQLite DB files in the project
 */
function findDatabaseFiles(projectDir) {
  const dbFiles = []
  const entries = fs.readdirSync(projectDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.db')) {
      dbFiles.push(path.join(projectDir, entry.name))
    }
  }
  // Also check data/ subdirectory
  const dataDir = path.join(projectDir, 'data')
  if (fs.existsSync(dataDir)) {
    const dataEntries = fs.readdirSync(dataDir, { withFileTypes: true })
    for (const entry of dataEntries) {
      if (entry.isFile() && entry.name.endsWith('.db')) {
        dbFiles.push(path.join(dataDir, entry.name))
      }
    }
  }
  return dbFiles
}

/**
 * Drop spellcheck tables and indexes from a SQLite database
 */
function cleanDatabase(dbPath) {
  const statements = []

  // Drop indexes first
  for (const idx of DB_INDEXES) {
    statements.push(`DROP INDEX IF EXISTS \`${idx}\`;`)
  }

  // Drop tables
  for (const table of DB_TABLES) {
    statements.push(`DROP TABLE IF EXISTS \`${table}\`;`)
  }

  // Also clean up payload_locked_documents_rels
  statements.push(
    `DELETE FROM \`payload_locked_documents_rels\` WHERE \`spellcheck_results_id\` IS NOT NULL;`,
    `DELETE FROM \`payload_locked_documents_rels\` WHERE \`spellcheck_dictionary_id\` IS NOT NULL;`,
  )

  // Remove the column from payload_locked_documents_rels (SQLite doesn't support DROP COLUMN easily)
  // Just log it as manual step

  const sql = statements.join('\n')
  // runSilent() swallows errors and returns '' both on success (no output) and
  // on failure, so `result !== undefined` was always true — the script reported
  // "Cleaned" even when sqlite3 was missing. Use the exit code instead.
  try {
    execSync(`sqlite3 "${dbPath}" "${sql}"`, { cwd: path.dirname(dbPath), stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// ── Main ──────────────────────────────────────────────

function main() {
  const projectDir = process.env.INIT_CWD || process.cwd()
  const srcDir = path.join(projectDir, 'src')
  const pm = detectPackageManager(projectDir)
  const keepData = process.argv.includes('--keep-data')
  const forceDb = process.argv.includes('--force-db')

  console.log('')
  console.log(`  \x1b[36m${PACKAGE_NAME}\x1b[0m — Full Uninstall`)
  console.log('  ─────────────────────────────────────────────')
  console.log(`  Project: \x1b[33m${projectDir}\x1b[0m`)
  console.log(`  Package manager: \x1b[33m${pm}\x1b[0m`)
  if (keepData) console.log(`  \x1b[33m--keep-data: DB tables will NOT be dropped\x1b[0m`)
  console.log('')

  // ── Step 1: Clean source files ──
  console.log('  \x1b[36m[1/4]\x1b[0m Cleaning source files...')

  // Tracks whether this project actually uses the plugin. The DROP TABLE step
  // is irreversible, so it must not run when nothing was found to uninstall.
  let sourceCleaned = false

  if (!fs.existsSync(srcDir)) {
    console.log('  \x1b[33m⚠\x1b[0m  No src/ directory found. Skipping code cleanup.')
  } else {
    const files = findSourceFiles(srcDir)
    const modified = []

    for (const filePath of files) {
      const result = processFile(filePath)
      if (result !== null) {
        fs.writeFileSync(filePath, result, 'utf-8')
        const rel = path.relative(projectDir, filePath)
        modified.push(rel)
        console.log(`  \x1b[32m✓\x1b[0m  Cleaned: ${rel}`)
      }
    }

    sourceCleaned = modified.length > 0

    if (modified.length === 0) {
      console.log('  \x1b[32m✓\x1b[0m  No references found in source files.')
    } else {
      console.log(`  \x1b[32m✓\x1b[0m  ${modified.length} file(s) cleaned.`)
    }
  }

  console.log('')

  // ── Step 2: Clean database ──
  // Gated on evidence that the plugin was really installed here (step 1 cleaned
  // a file, or the dependency is declared and will be removed by step 3).
  // Dropping the tables is the only irreversible action of this script; it used
  // to run unconditionally, even on projects that never had the plugin.
  const declaredAsDependency = isDeclaredDependency(projectDir)
  const pluginDetected = sourceCleaned || declaredAsDependency || forceDb

  if (!keepData && !pluginDetected) {
    console.log('  \x1b[36m[2/4]\x1b[0m Cleaning database...')
    console.log(`  \x1b[33m⚠\x1b[0m  ${PACKAGE_NAME} was not found in this project`)
    console.log('  \x1b[33m⚠\x1b[0m  (no source reference, not in package.json dependencies).')
    console.log('  \x1b[33m⚠\x1b[0m  Skipping the irreversible DROP TABLE step.')
    console.log('  \x1b[90m     Force it with --force-db if you know the tables are there.\x1b[0m')
  } else if (!keepData) {
    console.log('  \x1b[36m[2/4]\x1b[0m Cleaning database...')

    const dbFiles = findDatabaseFiles(projectDir)
    if (dbFiles.length === 0) {
      console.log('  \x1b[33m⚠\x1b[0m  No .db files found. Skipping DB cleanup.')
    } else {
      for (const dbFile of dbFiles) {
        const rel = path.relative(projectDir, dbFile)
        const success = cleanDatabase(dbFile)
        if (success) {
          console.log(`  \x1b[32m✓\x1b[0m  Cleaned: ${rel}`)
          for (const table of DB_TABLES) {
            console.log(`     \x1b[90m- Dropped table: ${table}\x1b[0m`)
          }
          for (const idx of DB_INDEXES) {
            console.log(`     \x1b[90m- Dropped index: ${idx}\x1b[0m`)
          }
        } else {
          console.log(`  \x1b[33m⚠\x1b[0m  Could not clean ${rel} (sqlite3 not found or DB locked)`)
        }
      }
    }
  } else {
    console.log('  \x1b[36m[2/4]\x1b[0m Skipping database cleanup (--keep-data)')
  }

  console.log('')

  // ── Step 3: Remove the package ──
  console.log('  \x1b[36m[3/4]\x1b[0m Removing package...')
  const removeCmd = pm === 'npm' ? 'npm uninstall' : `${pm} remove`
  run(`${removeCmd} ${PACKAGE_NAME}`, projectDir)

  console.log('')

  // ── Step 4: Regenerate importmap ──
  console.log('  \x1b[36m[4/4]\x1b[0m Regenerating importmap...')
  const importmapCmd = pm === 'npm' ? 'npx payload' : `${pm} payload`
  run(`${importmapCmd} generate:importmap`, projectDir)

  console.log('')

  // ── Done ──
  console.log('  \x1b[32m✓ Uninstall complete!\x1b[0m')
  console.log('')

  if (keepData) {
    console.log('  \x1b[36mNote:\x1b[0m Database tables were preserved (--keep-data).')
    console.log('  To manually drop them:')
    console.log('  \x1b[90m  sqlite3 your.db "DROP TABLE IF EXISTS spellcheck_results; DROP TABLE IF EXISTS spellcheck_dictionary;"\x1b[0m')
  } else {
    console.log('  \x1b[36mNote:\x1b[0m If columns \x1b[33mspellcheck_results_id\x1b[0m or \x1b[33mspellcheck_dictionary_id\x1b[0m')
    console.log('  remain in \x1b[33mpayload_locked_documents_rels\x1b[0m, they will be ignored by Payload.')
    console.log('  SQLite does not support DROP COLUMN natively.')
  }

  console.log('')
}

main()
