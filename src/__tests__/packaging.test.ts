/**
 * Regression tests for the published contract in package.json.
 *
 * The peer range used to be `payload: ^3.0.0`, which let a consumer satisfy the
 * plugin with a Payload older than 3.79.1 — the first release free of the
 * pre-authentication account takeover GHSA-hp5w-3hxx-vmwf (and of an SQL
 * injection). The plugin runs its dashboard on Payload's own `initPageResult`
 * and writes documents through the Local API, so a vulnerable core is a
 * vulnerable plugin: the floor belongs in the peer range, where the package
 * manager can enforce it, not in the README.
 *
 * The range was also plainly false: `AdminViewServerProps` (src/views) does not
 * exist in Payload < 3.2x, and the `req` prop the dashboard passes to
 * `DefaultTemplate` only appears in @payloadcms/next >= 3.44.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
  peerDependencies: Record<string, string>
}

/** Lowest version a `^x.y.z` range accepts, as a comparable tuple. */
function caretFloor(range: string): [number, number, number] {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (!match) throw new Error(`Not a simple caret range: ${range}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function gte(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return true
}

/** The first Payload release without GHSA-hp5w-3hxx-vmwf. */
const SECURITY_FLOOR: [number, number, number] = [3, 79, 1]

const PAYLOAD_PEERS = ['payload', '@payloadcms/next', '@payloadcms/ui']

describe('peer dependency ranges', () => {
  for (const name of PAYLOAD_PEERS) {
    it(`${name} cannot resolve to a Payload older than 3.79.1`, () => {
      const range = pkg.peerDependencies[name]
      expect(range, `${name} must stay a declared peer`).toBeTruthy()

      const floor = caretFloor(range)
      expect(
        gte(floor, SECURITY_FLOOR),
        `${name} is declared as ${range}, which allows a core older than 3.79.1`,
      ).toBe(true)

      // A caret range on a 3.x floor already excludes 4.x; assert the major so
      // that widening it back to `>=3` or `*` fails here rather than in the wild.
      expect(floor[0]).toBe(3)
    })
  }

  it('keeps react optional and unconstrained by the Payload floor', () => {
    // React is a separate axis: bumping the Payload floor must not silently
    // drop React 18 support for consumers who still run it.
    expect(pkg.peerDependencies.react).toBe('^18.0.0 || ^19.0.0')
  })
})

describe('lockfile', () => {
  it('records the same peer specifiers as package.json', () => {
    // `autoInstallPeers` writes the peer ranges into the importers block, so a
    // peer bump that skips `pnpm install` makes CI's
    // `pnpm install --frozen-lockfile` fail with ERR_PNPM_OUTDATED_LOCKFILE.
    const lock = readFileSync(join(packageRoot, 'pnpm-lock.yaml'), 'utf-8')
    const importers = lock.slice(lock.indexOf('importers:'), lock.indexOf('\npackages:'))

    for (const name of PAYLOAD_PEERS) {
      const key = name.startsWith('@') ? `'${name}':` : `${name}:`
      const entry = importers.indexOf(`      ${key}\n`)
      expect(entry, `${name} missing from the lockfile importers block`).toBeGreaterThan(-1)

      const specifier = /specifier: (\S+)/.exec(importers.slice(entry))?.[1]
      expect(specifier, `lockfile specifier for ${name}`).toBe(pkg.peerDependencies[name])
    }
  })
})
