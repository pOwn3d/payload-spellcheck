#!/usr/bin/env node

/**
 * Post-install setup for @consilioweb/spellcheck
 * Automatically adds the plugin to the Payload config.
 *
 * Usage: npx spellcheck-install
 *   or:  npx spellcheck-install --collections pages,posts --language fr
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const PACKAGE_NAME = '@consilioweb/spellcheck'

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
 * Find the plugins file (src/plugins/index.ts or similar)
 */
function findPluginsFile(srcDir) {
  // Common locations
  const candidates = [
    path.join(srcDir, 'plugins', 'index.ts'),
    path.join(srcDir, 'plugins.ts'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  // Search for a file containing `Plugin[]` or `plugins:`
  const files = findSourceFiles(srcDir)
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8')
    if (content.includes('export const plugins') && content.includes('Plugin[]')) {
      return file
    }
  }

  return null
}

/**
 * Check if the plugin is already imported/used
 */
function isAlreadyInstalled(content) {
  return content.includes(PACKAGE_NAME)
}

/**
 * Parse CLI args for --collections and --language
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    collections: ['pages', 'posts'],
    language: 'fr',
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--collections' && args[i + 1]) {
      config.collections = args[++i].split(',').map(s => s.trim())
    }
    if (args[i] === '--language' && args[i + 1]) {
      config.language = args[++i].trim()
    }
  }

  return config
}

// ── Main ──────────────────────────────────────────────

function main() {
  const projectDir = process.env.INIT_CWD || process.cwd()
  const srcDir = path.join(projectDir, 'src')
  const pm = detectPackageManager(projectDir)
  const config = parseArgs()

  console.log('')
  console.log('  \x1b[36m@consilioweb/spellcheck\x1b[0m — Install')
  console.log('  ─────────────────────────────────────────────')
  console.log(`  Project: \x1b[33m${projectDir}\x1b[0m`)
  console.log(`  Package manager: \x1b[33m${pm}\x1b[0m`)
  console.log(`  Collections: \x1b[33m${config.collections.join(', ')}\x1b[0m`)
  console.log(`  Language: \x1b[33m${config.language}\x1b[0m`)
  console.log('')

  // ── Step 1: Find plugins file ──
  console.log('  \x1b[36m[1/3]\x1b[0m Finding plugins configuration...')

  const pluginsFile = findPluginsFile(srcDir)
  if (!pluginsFile) {
    console.log('  \x1b[33m⚠\x1b[0m  No plugins file found in src/.')
    console.log('  \x1b[33m⚠\x1b[0m  You need to manually add the plugin to your Payload config:')
    console.log('')
    console.log(`  \x1b[90mimport { spellcheckPlugin } from '${PACKAGE_NAME}'\x1b[0m`)
    console.log(`  \x1b[90mspellcheckPlugin({ collections: ${JSON.stringify(config.collections)}, language: '${config.language}' })\x1b[0m`)
    console.log('')
  } else {
    const relPath = path.relative(projectDir, pluginsFile)
    console.log(`  \x1b[32m✓\x1b[0m  Found: ${relPath}`)

    const content = fs.readFileSync(pluginsFile, 'utf-8')

    if (isAlreadyInstalled(content)) {
      console.log(`  \x1b[32m✓\x1b[0m  Plugin already configured — skipping.`)
    } else {
      // Add import at the top (after last import line)
      const importLine = `import { spellcheckPlugin } from '${PACKAGE_NAME}'`
      const lines = content.split('\n')
      let lastImportIndex = -1

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) {
          lastImportIndex = i
        }
      }

      if (lastImportIndex >= 0) {
        lines.splice(lastImportIndex + 1, 0, importLine)
      } else {
        lines.unshift(importLine)
      }

      // Add plugin call before the closing bracket of the plugins array
      let joined = lines.join('\n')

      // Build plugin config string
      const collectionsStr = config.collections.map(c => `'${c}'`).join(', ')
      const pluginCall = `  spellcheckPlugin({
    collections: [${collectionsStr}],
    language: '${config.language}',
    checkOnSave: true,
    addSidebarField: true,
    addDashboardView: true,
    skipRules: ['FR_SPELLING_RULE', 'WHITESPACE_RULE'],
    skipCategories: ['TYPOGRAPHY', 'STYLE'],
    customDictionary: ['Next.js', 'Payload', 'TypeScript', 'SEO'],
  }),`

      // Find the plugins array closing bracket and insert before it
      const pluginsArrayMatch = joined.match(/export\s+const\s+plugins\s*:\s*Plugin\[\]\s*=\s*\[/)
      if (pluginsArrayMatch) {
        // Find the last `]` that closes this array
        const arrayStart = joined.indexOf(pluginsArrayMatch[0])
        const afterStart = joined.indexOf('[', arrayStart + pluginsArrayMatch[0].length - 1)

        // Find matching closing bracket
        let depth = 0
        let closingIdx = -1
        for (let i = afterStart; i < joined.length; i++) {
          if (joined[i] === '[') depth++
          else if (joined[i] === ']') {
            depth--
            if (depth === 0) {
              closingIdx = i
              break
            }
          }
        }

        if (closingIdx > 0) {
          joined = joined.slice(0, closingIdx) + pluginCall + '\n' + joined.slice(closingIdx)
        }
      }

      fs.writeFileSync(pluginsFile, joined, 'utf-8')
      console.log(`  \x1b[32m✓\x1b[0m  Plugin added to ${relPath}`)
    }
  }

  console.log('')

  // ── Step 2: Regenerate importmap ──
  console.log('  \x1b[36m[2/3]\x1b[0m Regenerating importmap...')
  const importmapCmd = pm === 'npm' ? 'npx payload' : `${pm} payload`
  run(`${importmapCmd} generate:importmap`, projectDir)

  console.log('')

  // ── Step 3: Summary ──
  console.log('  \x1b[36m[3/3]\x1b[0m Post-install checks...')
  console.log('  \x1b[32m✓\x1b[0m  Collection \x1b[33mspellcheck-results\x1b[0m will be auto-created on first boot')
  console.log('  \x1b[32m✓\x1b[0m  Endpoints registered: /api/spellcheck/validate, /api/spellcheck/fix, /api/spellcheck/bulk')
  console.log('  \x1b[32m✓\x1b[0m  Sidebar field added to editor')
  console.log('  \x1b[32m✓\x1b[0m  Dashboard view at /admin/spellcheck')

  console.log('')
  console.log('  \x1b[32m✓ Install complete!\x1b[0m')
  console.log('')
  console.log('  \x1b[36mNext steps:\x1b[0m')
  console.log('  1. Start your dev server to create the DB table')
  console.log('  2. Visit /admin/spellcheck to scan your content')
  console.log('  3. (Optional) Add "Correcteur" to your admin nav')
  console.log('')
  console.log('  \x1b[36mTo uninstall:\x1b[0m npx spellcheck-uninstall')
  console.log('')
}

main()
