import { defineConfig, type Options } from 'tsup'
import { writeFileSync, readFileSync } from 'fs'

const CLIENT_BANNER = '"use client";\n'

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
  // Client entry — React components
  {
    ...sharedConfig,
    entry: { client: 'src/client.ts' },
    clean: false,
    onSuccess: async () => {
      for (const file of ['dist/client.js', 'dist/client.cjs']) {
        const content = readFileSync(file, 'utf-8')
        writeFileSync(file, CLIENT_BANNER + content)
      }
      console.log('✓ Prepended "use client" to client bundles')
    },
  },
  // Views entry — server components with DefaultTemplate
  {
    ...sharedConfig,
    entry: { views: 'src/views.ts' },
    clean: false,
  },
])
