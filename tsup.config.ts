import { defineConfig, type Options } from 'tsup'
const sharedConfig: Partial<Options> = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  external: [
    'payload',
    '@payloadcms/ui',
    '@payloadcms/next',
    '@payloadcms/next/templates',
    'react',
    'react-dom',
    'react/jsx-runtime',
    'next',
    'next/navigation',
    '@consilioweb/spellcheck',
    '@consilioweb/spellcheck/client',
  ],
}

export default defineConfig([
  // Server entry — engine + plugin + types
  {
    ...sharedConfig,
    entry: { index: 'src/index.ts' },
    clean: true,
  },
  // Client entry — individual component files (NOT bundled)
  // This allows Next.js 16 Turbopack to resolve each component individually
  {
    ...sharedConfig,
    entry: [
      'src/client.ts',
      'src/components/SpellCheckField.tsx',
      'src/components/SpellCheckDashboard.tsx',
      'src/components/IssueCard.tsx',
      'src/components/SpellCheckScoreCell.tsx',
      'src/components/useSpellcheckI18n.ts',
      // Utility modules imported by components (must be emitted for bundle:false)
      'src/engine/filters.ts',
      'src/i18n.ts',
      'src/types.ts',
    ],
    bundle: false,
    clean: false,
    onSuccess: async () => {
      // Prepend "use client" to individual component files (NOT the barrel client.js)
      const { readdirSync, readFileSync, writeFileSync, statSync } = await import('fs')
      const { join } = await import('path')

      function addUseClient(dir: string) {
        for (const file of readdirSync(dir)) {
          const path = join(dir, file)
          if (statSync(path).isDirectory()) { addUseClient(path); continue }
          if (!file.endsWith('.js')) continue
          const content = readFileSync(path, 'utf-8')
          if (!content.startsWith('"use client"')) {
            writeFileSync(path, '"use client";\n' + content)
          }
        }
      }
      addUseClient('dist/components')
      console.log('✓ Prepended "use client" to individual component files (not barrel)')
    },
  },
  // Views entry — server components with DefaultTemplate
  {
    ...sharedConfig,
    entry: { views: 'src/views.ts' },
    clean: false,
  },
])
