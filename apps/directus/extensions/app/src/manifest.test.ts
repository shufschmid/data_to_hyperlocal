import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Directus loads only what the manifest names. A folder under src/operations
// whose api.ts has no entry still BUILDS — an endpoint may import its handler,
// so the code ends up in dist/api.js — and the Flow that names the operation
// fails only when it fires, with "operation not found". That is how
// gemeindeseiten-pruefen shipped without its entry on 14 September 2026; this
// test is the guard, in both directions.

const WURZEL = join(__dirname, '..')

interface Eintrag {
  type: string
  name: string
  source: string | { app: string; api: string }
}

function manifest(): Eintrag[] {
  const paket = JSON.parse(
    readFileSync(join(WURZEL, 'package.json'), 'utf8')
  ) as {
    'directus:extension': { entries: Eintrag[] }
  }
  return paket['directus:extension'].entries
}

function ordnerMit(unterordner: string, datei: string): string[] {
  return readdirSync(join(WURZEL, 'src', unterordner)).filter((d) =>
    existsSync(join(WURZEL, 'src', unterordner, d, datei))
  )
}

describe('Bundle-Manifest', () => {
  it('nennt jede Operation, jeden Endpoint und jeden Hook im Quellbaum — und nichts darüber hinaus', () => {
    const genannt = new Set(manifest().map((e) => `${e.type}:${e.name}`))
    const imQuellbaum = [
      ...ordnerMit('operations', 'api.ts').map((d) => `operation:${d}`),
      ...ordnerMit('endpoints', 'index.ts').map((d) => `endpoint:${d}`),
      ...ordnerMit('hooks', 'index.ts').map((d) => `hook:${d}`)
    ]
    expect(imQuellbaum.filter((x) => !genannt.has(x))).toEqual([])
    expect([...genannt].filter((x) => !imQuellbaum.includes(x))).toEqual([])
  })

  it('zeigt mit jedem Eintrag auf vorhandene Dateien', () => {
    for (const eintrag of manifest()) {
      const quellen =
        typeof eintrag.source === 'string'
          ? [eintrag.source]
          : [eintrag.source.app, eintrag.source.api]
      for (const quelle of quellen) {
        expect(
          existsSync(join(WURZEL, quelle)),
          `${eintrag.name}: ${quelle}`
        ).toBe(true)
      }
    }
  })
})
