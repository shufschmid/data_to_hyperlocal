import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTFERNT_GRUENDE } from './shared/buschtelefon/typen'

// The Buschtelefon desk's data model is written BY HAND into the snapshot
// (apps/directus/CLAUDE.md, «The dump is not the only way»), so nothing but
// this test reads it before a container boots and pushes it. It holds the
// few properties the rest of the build leans on and a dump would not have
// got wrong: no revisions on personal data, the identity as a snapshot
// unique, the names the code writes, the Flow pointing at its operation and
// the four variables in all three files.

const APP = join(__dirname, '..')
const DIRECTUS = join(APP, '..', '..')
const WURZEL = join(DIRECTUS, '..', '..')
const SNAPSHOT = join(DIRECTUS, 'schema', 'snapshot')

interface Feld {
  collection: string
  field: string
  type: string
  meta: {
    collection: string
    field: string
    sort: number
    special: string[] | null
    options: { choices?: { text: string; value: string }[] } | null
  }
  schema: {
    name: string
    table: string
    data_type: string
    default_value: unknown
    max_length: number | null
    is_nullable: boolean
    is_unique: boolean
    is_primary_key: boolean
    foreign_key_table: string | null
  }
}

function json<T>(...pfad: string[]): T {
  return JSON.parse(readFileSync(join(...pfad), 'utf8')) as T
}

function felder(collection: string): Map<string, Feld> {
  const ordner = join(SNAPSHOT, 'fields', collection)
  return new Map(
    readdirSync(ordner).map((datei) => {
      const feld = json<Feld>(ordner, datei)
      return [datei.replace(/\.json$/, ''), feld]
    })
  )
}

function werte(feld: Feld | undefined): string[] {
  return (feld?.meta.options?.choices ?? []).map((c) => c.value)
}

const SAMMLUNGEN = [
  'buschtelefon_funde',
  'buschtelefon_quellen',
  'buschtelefon_stand'
]

describe('Buschtelefon-Datenmodell', () => {
  it('führt keine der drei Sammlungen mit Aktivität oder Revisionen', () => {
    for (const name of SAMMLUNGEN) {
      const sammlung = json<{
        collection: string
        meta: { accountability: string | null; singleton: boolean }
        schema: { name: string }
      }>(SNAPSHOT, 'collections', `${name}.json`)
      expect(sammlung.collection).toBe(name)
      expect(sammlung.schema.name).toBe(name)
      // Statements of private persons: no copy in directus_revisions.
      expect(sammlung.meta.accountability, name).toBeNull()
      expect(sammlung.meta.singleton, name).toBe(name === 'buschtelefon_stand')
    }
  })

  it('gibt keiner der drei Sammlungen eine Berechtigungszeile', () => {
    const rechte = readFileSync(
      join(DIRECTUS, 'schema', 'collections', 'permissions.json'),
      'utf8'
    )
    expect(rechte).not.toContain('buschtelefon')
  })

  it('schreibt jedes Feld unter seinem Dateinamen, mit eigener Sortierung und einem Primärschlüssel', () => {
    for (const name of SAMMLUNGEN) {
      const alle = felder(name)
      const sortierungen = new Set<number>()
      for (const [datei, feld] of alle) {
        expect(feld.field, `${name}/${datei}`).toBe(datei)
        expect(feld.collection).toBe(name)
        expect(feld.meta.collection).toBe(name)
        expect(feld.meta.field).toBe(datei)
        expect(feld.schema.name).toBe(datei)
        expect(feld.schema.table).toBe(name)
        sortierungen.add(feld.meta.sort)
      }
      expect(sortierungen.size, `${name}: doppelte Sortierung`).toBe(alle.size)
      expect(
        [...alle.values()]
          .filter((f) => f.schema.is_primary_key)
          .map((f) => f.field)
      ).toEqual(['id'])
    }
  })

  it('trägt am Fund genau die Felder der Bauvorgabe', () => {
    expect([...felder('buschtelefon_funde').keys()].sort()).toEqual(
      [
        'id',
        'kennung',
        'folge',
        'status',
        'kanal',
        'quelle',
        'quelle_name',
        'quelle_art',
        'quelle_sichtbarkeit',
        'quelle_url',
        'gemeinde',
        'gemeinden_bfs',
        'link',
        'veroeffentlicht_am',
        'veroeffentlicht_tag',
        'datum_genauigkeit',
        'autor_art',
        'autor_rolle',
        'autor_name',
        'autor_vorname',
        'autor_ref',
        'text',
        'text_abgeschnitten',
        'bilder',
        'n_bilder',
        'verlinkt',
        'geteilt',
        'kommentare',
        'kommentare_stand',
        'kommentare_fehlend',
        'kommentare_geprueft_am',
        'n_kommentare',
        'n_reaktionen',
        'n_geteilt',
        'doublette_von',
        'erstmals_freigegeben_am',
        'geaendert_am',
        'aenderung',
        'beobachtet_bis',
        'aktualisiert_am',
        'neue_kommentare',
        'hinweise',
        'vorschlag',
        'vorschlag_wert',
        'vorschlag_begruendung',
        'gesichtet_folge',
        'entwurf_bedenken',
        'entscheid',
        'ablehnungsgrund',
        'ablehnungskommentar',
        'entschieden_am',
        'material_geloescht_am',
        'entfernt_grund',
        'date_created',
        'date_updated'
      ].sort()
    )
  })

  it('macht die Kennung zur Identität — im Snapshot, nicht in der Migration', () => {
    const fund = felder('buschtelefon_funde').get('kennung')
    expect(fund?.schema.is_unique).toBe(true)
    expect(fund?.schema.is_nullable).toBe(false)
    expect(fund?.schema.max_length).toBe(64)
    const quelle = felder('buschtelefon_quellen').get('kennung')
    expect(quelle?.schema.is_unique).toBe(true)
    expect(quelle?.schema.is_nullable).toBe(false)
    expect(quelle?.schema.max_length).toBe(100)
  })

  it('hält die Längen des Vertrags und die Vorgaben der Zeile', () => {
    const fund = felder('buschtelefon_funde')
    const laenge = (name: string) => fund.get(name)?.schema.max_length
    expect(laenge('quelle')).toBe(100)
    expect(laenge('quelle_name')).toBe(255)
    expect(laenge('quelle_url')).toBe(2000)
    expect(laenge('link')).toBe(2000)
    expect(laenge('autor_vorname')).toBe(60)
    expect(laenge('autor_ref')).toBe(8)
    expect(laenge('doublette_von')).toBe(64)
    expect(laenge('ablehnungsgrund')).toBe(30)
    expect(laenge('entfernt_grund')).toBe(30)
    expect(fund.get('entfernt_grund')?.schema.is_nullable).toBe(true)

    // The change number outgrows no integer: bigint on both sides.
    for (const name of ['folge', 'gesichtet_folge']) {
      expect(fund.get(name)?.type, name).toBe('bigInteger')
      expect(fund.get(name)?.schema.data_type, name).toBe('bigint')
    }
    expect(fund.get('folge')?.schema.is_nullable).toBe(false)
    expect(fund.get('gesichtet_folge')?.schema.is_nullable).toBe(true)
    expect(felder('buschtelefon_stand').get('folge')?.type).toBe('bigInteger')

    expect(fund.get('status')?.schema.default_value).toBe('aktiv')
    expect(fund.get('entscheid')?.schema.default_value).toBe('offen')
    expect(fund.get('entscheid')?.schema.is_nullable).toBe(false)
    expect(fund.get('text_abgeschnitten')?.schema.default_value).toBe(false)
    expect(fund.get('neue_kommentare')?.schema.default_value).toBe(0)
    expect(fund.get('erstmals_freigegeben_am')?.schema.is_nullable).toBe(false)
    // null means "not judged" — a default would turn it into a no.
    expect(fund.get('vorschlag')?.schema.default_value).toBeNull()
    expect(fund.get('vorschlag')?.schema.is_nullable).toBe(true)
    // The day a source line prints is a DATE, not an instant cut to ten characters.
    expect(fund.get('veroeffentlicht_tag')?.schema.data_type).toBe('date')
  })

  it('speichert Listen als JSON — ein Hinweis darf ein Komma tragen', () => {
    const fund = felder('buschtelefon_funde')
    for (const name of [
      'gemeinden_bfs',
      'bilder',
      'verlinkt',
      'geteilt',
      'kommentare',
      'aenderung',
      'hinweise'
    ]) {
      expect(fund.get(name)?.type, name).toBe('json')
      expect(fund.get(name)?.meta.special, name).toEqual(['cast-json'])
    }
  })

  it('nennt die Werte, die Vertrag und Bauvorgabe festlegen', () => {
    const fund = felder('buschtelefon_funde')
    expect(werte(fund.get('status'))).toEqual([
      'aktiv',
      'nicht_erreichbar',
      'entfernt'
    ])
    expect(werte(fund.get('kanal'))).toEqual([
      'facebook',
      'instagram',
      'tiktok'
    ])
    expect(werte(fund.get('quelle_sichtbarkeit'))).toEqual([
      'oeffentlich',
      'geschlossen',
      'unbekannt'
    ])
    expect(werte(fund.get('entscheid'))).toEqual([
      'offen',
      'uebernommen',
      'abgelehnt',
      'weitergereicht',
      'verfallen'
    ])
    expect(werte(fund.get('ablehnungsgrund'))).toEqual([
      'nicht_relevant',
      'unbestaetigt',
      'personenbezug',
      'doublette',
      'veraltet',
      'andere'
    ])
    // The contract's reasons for a tombstone (4.9) — the same list as the parser's.
    expect(werte(fund.get('entfernt_grund'))).toEqual([...ENTFERNT_GRUENDE])
    // Every value fits its column.
    for (const feld of fund.values()) {
      const breite = feld.schema.max_length
      if (breite === null) continue
      for (const wert of werte(feld)) {
        expect(wert.length, `${feld.field}: ${wert}`).toBeLessThanOrEqual(
          breite
        )
      }
    }
  })

  it('hängt die Gemeinde und die zwei Herkunftsfelder mit SET NULL an', () => {
    const paare: [string, string, string][] = [
      ['buschtelefon_funde', 'gemeinde', 'gemeinden'],
      ['meldungen', 'buschtelefon_fund', 'buschtelefon_funde'],
      ['recherchehinweise', 'buschtelefon_fund', 'buschtelefon_funde']
    ]
    for (const [sammlung, name, ziel] of paare) {
      const feld = felder(sammlung).get(name)
      expect(feld?.type, `${sammlung}.${name}`).toBe('uuid')
      expect(feld?.meta.special).toEqual(['m2o'])
      expect(feld?.schema.is_nullable).toBe(true)
      expect(feld?.schema.foreign_key_table).toBe(ziel)

      const relation = json<{
        collection: string
        field: string
        related_collection: string
        meta: {
          many_collection: string
          many_field: string
          one_collection: string
        }
        schema: {
          table: string
          column: string
          foreign_key_table: string
          constraint_name: string
          on_delete: string
        }
      }>(SNAPSHOT, 'relations', sammlung, `${name}.json`)
      expect(relation.collection).toBe(sammlung)
      expect(relation.field).toBe(name)
      expect(relation.related_collection).toBe(ziel)
      expect(relation.meta.many_collection).toBe(sammlung)
      expect(relation.meta.many_field).toBe(name)
      expect(relation.meta.one_collection).toBe(ziel)
      expect(relation.schema.table).toBe(sammlung)
      expect(relation.schema.column).toBe(name)
      expect(relation.schema.foreign_key_table).toBe(ziel)
      expect(relation.schema.constraint_name).toBe(
        `${sammlung}_${name}_foreign`
      )
      expect(relation.schema.on_delete).toBe('SET NULL')
    }
  })

  it('gibt den Herkunftsfeldern eine Sortierung, die in ihrer Sammlung frei war', () => {
    for (const sammlung of ['meldungen', 'recherchehinweise']) {
      const alle = [...felder(sammlung).values()]
      const eigene = alle.find((f) => f.field === 'buschtelefon_fund')
      expect(
        alle
          .filter((f) => f.meta.sort === eigene?.meta.sort)
          .map((f) => f.field),
        sammlung
      ).toEqual(['buschtelefon_fund'])
    }
  })

  it('kennt den Tisch als Bereich der Regeln und als benotenden Tisch', () => {
    const bereich = felder('redaktionswissen').get('bereich')
    expect(werte(bereich)).toContain('buschtelefon')
    expect('buschtelefon'.length).toBeLessThanOrEqual(
      bereich?.schema.max_length ?? 0
    )
    const tisch = felder('tischeinstellungen').get('tisch')
    expect(werte(tisch)).toEqual(['gemeinde', 'veranstaltung', 'buschtelefon'])
  })

  it('lässt den Flow um 12, 13 und 14 Uhr auf seine Operation zeigen — und sie zurück', () => {
    const flows = json<
      {
        name: string
        status: string
        trigger: string
        accountability: string | null
        options: { cron: string }
        operation: string
        _syncId: string
      }[]
    >(DIRECTUS, 'schema', 'collections', 'flows.json')
    const operationen = json<
      {
        type: string
        options: Record<string, unknown>
        flow: string
        _syncId: string
      }[]
    >(DIRECTUS, 'schema', 'collections', 'operations.json')

    const flow = flows.filter((f) => f.name === 'Buschtelefon abholen')
    expect(flow).toHaveLength(1)
    expect(flow[0]?.trigger).toBe('schedule')
    expect(flow[0]?.status).toBe('active')
    expect(flow[0]?.options.cron).toBe('0 0 12,13,14 * * *')
    // The run's result names finds and is logged per operation: `activity`
    // keeps the log line and never copies the result into directus_revisions.
    expect(flow[0]?.accountability).toBe('activity')

    const operation = operationen.filter(
      (o) => o.type === 'buschtelefon-abholen'
    )
    expect(operation).toHaveLength(1)
    expect(operation[0]?.options).toEqual({ limit: 200 })
    expect(flow[0]?.operation).toBe(operation[0]?._syncId)
    expect(operation[0]?.flow).toBe(flow[0]?._syncId)

    // The ids are written by hand: neither may collide with an existing one.
    const ids = [
      ...flows.map((f) => f._syncId),
      ...operationen.map((o) => o._syncId)
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('nennt die Operation im Manifest des Bundles', () => {
    const paket = json<{
      'directus:extension': {
        entries: { type: string; name: string; source: unknown }[]
      }
    }>(APP, 'package.json')
    expect(
      paket['directus:extension'].entries.find(
        (e) => e.name === 'buschtelefon-abholen'
      )
    ).toEqual({
      type: 'operation',
      name: 'buschtelefon-abholen',
      source: {
        app: 'src/operations/buschtelefon-abholen/app.ts',
        api: 'src/operations/buschtelefon-abholen/api.ts'
      }
    })
  })

  it('führt die vier Variablen in allen drei Dateien', () => {
    const dateien = [
      join(DIRECTUS, '.env.example'),
      join(WURZEL, '.env.example'),
      join(WURZEL, 'docker-compose.yml')
    ]
    for (const datei of dateien) {
      expect(existsSync(datei), datei).toBe(true)
      const inhalt = readFileSync(datei, 'utf8')
      for (const name of [
        'BUSCHTELEFON_URL',
        'BUSCHTELEFON_CF_CLIENT_ID',
        'BUSCHTELEFON_CF_CLIENT_SECRET',
        'BUSCHTELEFON_SCHLUESSEL'
      ]) {
        expect(inhalt, `${datei}: ${name}`).toMatch(
          new RegExp(`^\\s*${name}[=:]`, 'm')
        )
      }
    }
    // The address has a default in Docker; the three secrets never do.
    const compose = readFileSync(join(WURZEL, 'docker-compose.yml'), 'utf8')
    expect(compose).toContain(
      'BUSCHTELEFON_URL: ${BUSCHTELEFON_URL:-https://buschtelefon.raumschiffenterprise.ch}'
    )
    for (const name of [
      'BUSCHTELEFON_CF_CLIENT_ID',
      'BUSCHTELEFON_CF_CLIENT_SECRET',
      'BUSCHTELEFON_SCHLUESSEL'
    ]) {
      expect(compose).toContain(`${name}: \${${name}:-}`)
    }
  })

  it('lässt der Migration nur den Teilindex und die Zeile des Tischs', () => {
    const migration = readFileSync(
      join(DIRECTUS, 'migrations', '20261111A-buschtelefon.mts'),
      'utf8'
    )
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_buschtelefon_fund_uniq ON meldungen (buschtelefon_fund) WHERE buschtelefon_fund IS NOT NULL AND status <> 'verworfen'"
    )
    expect(migration).toContain(
      'DROP INDEX IF EXISTS meldungen_buschtelefon_fund_uniq'
    )
    expect(migration).toMatch(/export async function up\(/)
    expect(migration).toMatch(/export async function down\(/)
    // Structure is the snapshot's: no table, no column, no single-column unique here.
    expect(migration).not.toMatch(
      /createTable|CREATE TABLE|ALTER TABLE|ADD COLUMN|\.alterTable\(/
    )
    expect(migration).not.toMatch(/buschtelefon_funde\s*\(\s*kennung\s*\)/)
    expect(migration).toMatch(/tisch: 'buschtelefon'/)
    expect(migration).toMatch(/schwelle: 3/)
  })
})
