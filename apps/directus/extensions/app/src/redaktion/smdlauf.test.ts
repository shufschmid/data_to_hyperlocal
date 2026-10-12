import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseDossier } from '../shared/smd/parse'
import type { LinkErgebnis, Linksucher } from '../shared/verlage'
import {
  raeumeSmdAuf,
  verarbeiteDossier,
  zeilenAus,
  type BeitraegeDienst
} from './smdlauf'
import { kandidatenAus } from './smd'

const lesung = parseDossier(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        'shared',
        'smd',
        'fixtures',
        'dossier-2026-10-11.json'
      ),
      'utf8'
    )
  ) as string[]
)
const GEMEINDEN = [
  { id: 'g-aesch', name: 'Aesch' },
  { id: 'g-pratteln', name: 'Pratteln' },
  { id: 'g-reinach', name: 'Reinach' }
]
const LOGGER = { info: () => undefined, warn: () => undefined }

function dienst(
  vorhanden: Array<{ schluessel: string; gemeinde: string }> = []
) {
  const angelegt: Record<string, unknown>[] = []
  const d: BeitraegeDienst = {
    readByQuery: vi.fn(async (query: Record<string, unknown>) => {
      const filter = query['filter'] as
        | { schluessel?: { _in: string[] } }
        | undefined
      if (filter?.schluessel !== undefined)
        return vorhanden.filter((v) =>
          filter.schluessel!._in.includes(v.schluessel)
        )
      return []
    }),
    createOne: vi.fn(async (payload: Record<string, unknown>) => {
      angelegt.push(payload)
      return `id-${angelegt.length}`
    }),
    updateOne: vi.fn(async () => undefined),
    updateMany: vi.fn(async () => undefined),
    deleteMany: vi.fn(async () => undefined)
  }
  return { d, angelegt }
}

function sucher(
  antwort: (medium: string) => LinkErgebnis
): Linksucher & { aufrufe: string[] } {
  const aufrufe: string[] = []
  return {
    aufrufe,
    suche: vi.fn(async (medium: string, stueck: { titel: string }) => {
      aufrufe.push(`${medium}|${stueck.titel}`)
      return antwort(medium)
    }),
    protokoll: () => ({ anfragen: 0, seiten: 0, hosts: [] })
  }
}

describe('verarbeiteDossier — Dokumente, Blog-Eintraege, Gemeinden, Dedup, Links', () => {
  it('legt je Beitrag und genannter Gemeinde eine Zeile an, fragt den Link einmal je Beitrag', async () => {
    const { d, angelegt } = dienst()
    const s = sucher((medium) =>
      medium === 'bzbasel.ch'
        ? {
            status: 'gefunden',
            treffer: {
              url: 'https://www.bzbasel.ch/x-ld.1',
              titel: 'X',
              abo: true,
              weg: 'sitemap-titel'
            }
          }
        : { status: 'nicht_gefunden', hinweis: 'nix' }
    )
    const e = await verarbeiteDossier(lesung, {
      dossierId: 'd-1',
      dossierDatum: '2026-10-11',
      gemeinden: GEMEINDEN,
      beitraege: d,
      linksucher: s,
      logger: LOGGER
    })
    expect(e.dokumente).toBe(4)
    expect(e.blogs).toBe(1)
    expect(e.blogEintraege).toBe(3)
    expect(e.blogAlt).toBe(1)
    // 2 blog entries + 3 articles = 5 candidates; only the RTV handball
    // entry names no covered municipality («Sm’Aesch» names Aesch — the
    // apostrophe is a word boundary).
    expect(e.kandidaten).toBe(5)
    expect(e.ohneGemeinde).toBe(1)
    expect(e.neu).toBe(4)
    expect(e.wiederholt).toBe(0)
    expect(angelegt.map((z) => [z['medium'], z['gemeinde'], z['art']])).toEqual(
      [
        ['bzbasel.ch', 'g-aesch', 'blogeintrag'],
        ['bzbasel.ch', 'g-pratteln', 'artikel'],
        ['bazonline.ch', 'g-aesch', 'artikel'],
        ['bzbasel.ch', 'g-aesch', 'artikel']
      ]
    )
    expect(e.links).toEqual({
      gefunden: 3,
      nichtGefunden: 1,
      keineTuer: 0,
      fehler: 0
    })
    expect(s.aufrufe).toHaveLength(4)
    expect(angelegt[0]).toMatchObject({
      dossier: 'd-1',
      blog: 'Regiosport-Aktuell',
      zeit: '22:28',
      link_url: 'https://www.bzbasel.ch/x-ld.1',
      link_status: 'gefunden',
      link_abo: true,
      entscheid: 'offen',
      gemeinden_genannt: ['Aesch']
    })
    expect(angelegt[2]).toMatchObject({
      link_url: null,
      link_status: 'nicht_gefunden',
      link_hinweis: 'nix'
    })
    expect(e.angelegt.get('g-aesch')?.map((z) => z.id)).toEqual([
      'id-1',
      'id-3',
      'id-4'
    ])
  })

  it('eine schon gespeicherte (Schluessel, Gemeinde) ist eine Wiederholung — kein Link, keine Zeile', async () => {
    const kurve = kandidatenAus(lesung.dokumente[1]!, '2026-10-11')
      .kandidaten[0]!
    const { d, angelegt } = dienst([
      { schluessel: kurve.schluessel, gemeinde: 'g-pratteln' }
    ])
    const s = sucher(() => ({ status: 'keine_tuer' }))
    const e = await verarbeiteDossier(lesung, {
      dossierId: 'd-2',
      dossierDatum: '2026-10-11',
      gemeinden: GEMEINDEN,
      beitraege: d,
      linksucher: s,
      logger: LOGGER
    })
    expect(e.wiederholt).toBe(1)
    expect(e.neu).toBe(3)
    expect(angelegt.some((z) => z['schluessel'] === kurve.schluessel)).toBe(
      false
    )
    expect(s.aufrufe.some((a) => a.includes('Kurve verpasst'))).toBe(false)
    expect(e.links.keineTuer).toBe(3)
  })

  it('ein Unique-Fehler beim Speichern ist eine Wiederholung, jeder andere ein benannter Fehler', async () => {
    const { d } = dienst()
    let n = 0
    d.createOne = vi.fn(async () => {
      n += 1
      if (n === 1)
        throw new Error('duplicate key value violates unique constraint')
      throw new Error('Spalte zu kurz')
    })
    const e = await verarbeiteDossier(lesung, {
      dossierId: 'd-3',
      dossierDatum: '2026-10-11',
      gemeinden: GEMEINDEN,
      beitraege: d,
      linksucher: sucher(() => ({ status: 'keine_tuer' })),
      logger: LOGGER
    })
    expect(e.neu).toBe(0)
    expect(e.wiederholt).toBe(1)
    expect(e.fehler).toHaveLength(3)
    expect(e.fehler[0]).toMatch(/Spalte zu kurz/)
  })
})

describe('zeilenAus', () => {
  it('kappt den Text und sagt es, kuerzt Titel und Autor auf die Spaltenbreite', () => {
    const kandidat = {
      ...kandidatenAus(lesung.dokumente[1]!, '2026-10-11').kandidaten[0]!,
      text: 'x'.repeat(25_000)
    }
    const [zeile] = zeilenAus({
      kandidat,
      dossierId: 'd',
      getroffene: [{ id: 'g', name: 'Pratteln' }],
      link: {
        link_url: null,
        link_status: 'keine_tuer',
        link_abo: null,
        link_titel: null,
        link_hinweis: null
      }
    })
    expect(zeile?.text_abgeschnitten).toBe(true)
    expect(zeile?.hinweise).toEqual(['Text gekürzt'])
    expect(zeile?.text?.length).toBeLessThan(25_000)
  })
})

describe('raeumeSmdAuf', () => {
  it('loescht Unvorgeschlagenes nach sieben Tagen und laesst Vorschlaege nach vierzehn verfallen', async () => {
    const { d } = dienst()
    d.readByQuery = vi.fn(async () => [
      {
        id: 'alt',
        entscheid: 'offen',
        vorschlag: false,
        datum: '2026-10-01',
        date_created: null
      },
      {
        id: 'vorschlag-alt',
        entscheid: 'offen',
        vorschlag: true,
        datum: '2026-09-20',
        date_created: null
      },
      {
        id: 'frisch',
        entscheid: 'offen',
        vorschlag: false,
        datum: '2026-10-10',
        date_created: null
      }
    ])
    const e = await raeumeSmdAuf(d, '2026-10-12', 4, LOGGER)
    expect(e).toEqual({ geloescht: 1, verfallen: 1 })
    expect(d.deleteMany).toHaveBeenCalledWith(['alt'])
    expect(d.updateMany).toHaveBeenCalledWith(['vorschlag-alt'], {
      entscheid: 'verfallen'
    })
  })
})
