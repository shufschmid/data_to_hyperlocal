import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  angabenAusDetail,
  fristAusDetail,
  kantonVonBezirk,
  ordneZuErfuellungsort,
  parseSuche,
  projektIdAusLink,
  pubTypText,
  textVon,
  webLink,
  type SimapGemeinde
} from './parse'

// Every fixture is a real simap.ch answer, fetched on 2 September 2026 — the
// tests pin this connector against the platform's actual shapes rather than a
// hand-written idea of them.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf-8'))
}

const GEMEINDEN: SimapGemeinde[] = [
  { id: 'g-pratteln', name: 'Pratteln', bezirk: 'Liestal', plz: ['4133'] },
  { id: 'g-reinach', name: 'Reinach', bezirk: 'Arlesheim', plz: ['4153'] },
  { id: 'g-riehen', name: 'Riehen', bezirk: 'Basel-Stadt', plz: ['4125'] }
]

describe('parseSuche', () => {
  it('reads the real search answer, its rows and its pagination cursor', async () => {
    const ergebnis = parseSuche(await fixture('suche-pratteln.json'))

    expect(ergebnis.projekte.length).toBeGreaterThan(5)
    expect(ergebnis.weiter).toBe('20250120|2325')

    const zuschlag = ergebnis.projekte.find((p) => p.pubTyp === 'award')
    expect(zuschlag).toBeDefined()
    expect(zuschlag!.titel).toContain('Gärtnerarbeiten')
    expect(zuschlag!.vergabestelle).toBe('Gemeinde Pratteln')
    expect(zuschlag!.ort?.postalCode).toBe('4133')
    expect(zuschlag!.ort?.cantonId).toBe('BL')
    expect(zuschlag!.publicationId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('drops a row without an id rather than repairing it — it could be neither deduped nor linked', () => {
    const ergebnis = parseSuche({
      projects: [
        { id: 'a', publicationId: '', title: { de: 'ohne Publikation' } },
        { publicationId: 'b', title: { de: 'ohne Projekt' } },
        { id: 'c', publicationId: 'd', title: { de: 'gut' } }
      ]
    })
    expect(ergebnis.projekte.map((p) => p.titel)).toEqual(['gut'])
  })

  it('tolerates a publication whose place is prose only', () => {
    const ergebnis = parseSuche({
      projects: [{ id: 'a', publicationId: 'b', orderAddress: null }]
    })
    expect(ergebnis.projekte[0]!.ort).toBeNull()
  })

  it('throws when the answer is not a search answer at all', () => {
    expect(() => parseSuche('nope')).toThrow()
    expect(() => parseSuche({})).toThrow()
  })
})

describe('textVon', () => {
  it('prefers German, falls back to the next language that exists', () => {
    expect(textVon({ de: 'Deutsch', fr: 'Französisch' })).toBe('Deutsch')
    expect(textVon({ de: null, fr: 'Französisch' })).toBe('Französisch')
    expect(textVon(null)).toBe('')
  })
})

describe('ordneZuErfuellungsort', () => {
  it('matches on the postcode', async () => {
    const { projekte } = parseSuche(await fixture('suche-pratteln.json'))
    const mitOrt = projekte.find((p) => p.ort?.postalCode === '4133')!
    expect(ordneZuErfuellungsort(mitOrt, GEMEINDEN)?.id).toBe('g-pratteln')
  })

  // The reason this function exists. Reinach AG and Reinach BL share a name,
  // and so do Aesch BL, Aesch LU and Aesch ZH.
  it('rejects the same-named municipality in another canton', async () => {
    const { projekte } = parseSuche(await fixture('suche-reinach-ag.json'))
    const ag = projekte[0]!
    expect(ag.ort?.postalCode).toBe('5734')
    expect(ag.ort?.city?.de).toBe('Reinach')
    expect(ordneZuErfuellungsort(ag, GEMEINDEN)).toBeNull()
  })

  it('returns null for a publication without a postcode', () => {
    const { projekte } = parseSuche({
      projects: [{ id: 'a', publicationId: 'b', orderAddress: null }]
    })
    expect(ordneZuErfuellungsort(projekte[0]!, GEMEINDEN)).toBeNull()
  })
})

describe('pubTypText', () => {
  it('names the types in German and marks a correction', () => {
    expect(pubTypText('tender')).toBe('Ausschreibung')
    expect(pubTypText('award')).toBe('Zuschlag')
    expect(pubTypText('direct_award')).toBe('Freihaendige Vergabe')
    expect(pubTypText('award', true)).toBe('Zuschlag (berichtigt)')
  })

  it('keeps an unknown type instead of dropping or guessing it', () => {
    expect(pubTypText('etwas_neues')).toBe('etwas_neues')
  })
})

describe('webLink / projektIdAusLink', () => {
  it('builds the language-prefixed public link and reads the id back out', () => {
    const id = '5df54c6c-3ca5-458b-af05-db9d1d18f880'
    // Without the /de/ segment simap answers 302 — measured.
    expect(webLink(id)).toBe(`https://www.simap.ch/de/project-detail/${id}`)
    expect(projektIdAusLink(webLink(id))).toBe(id)
  })

  it('returns null for a link that is not a project link', () => {
    expect(projektIdAusLink(null)).toBeNull()
    expect(
      projektIdAusLink('https://amtsblattportal.ch/api/v1/x/pdf')
    ).toBeNull()
  })
})

describe('kantonVonBezirk', () => {
  it('reads the canton out of the district, which is where it lives', () => {
    expect(kantonVonBezirk('Dorneck (SO)')).toBe('SO')
    expect(kantonVonBezirk('Basel-Stadt')).toBe('BS')
    expect(kantonVonBezirk('Arlesheim')).toBe('BL')
  })
})

describe('fristAusDetail', () => {
  it('takes the tender deadline as a DATE, without parsing the timestamp', async () => {
    const detail = await fixture('detail-ausschreibung.json')
    // The fixture says "2026-10-12T16:00:00+02:00". Sliced, not parsed: a
    // late-evening deadline would move to the previous day in UTC.
    expect(fristAusDetail(detail)).toBe('2026-10-12')
  })

  it('has no deadline for an award — the appeal period is not published as a date', async () => {
    expect(fristAusDetail(await fixture('detail-zuschlag.json'))).toBeNull()
  })
})

describe('angabenAusDetail', () => {
  it('renders an award: who got it, for how much, against how many', async () => {
    const angaben = angabenAusDetail(
      await fixture('detail-zuschlag.json'),
      'award'
    )
    const je = new Map(angaben.map((a) => [a.bezeichnung, a.wert]))

    expect(je.get('Auftraggeberin')).toContain('Gemeinde Pratteln')
    expect(je.get('Art der Beschaffung')).toBe('Zuschlag')
    expect(je.get('Zuschlag an')).toContain('Schneider Gartengestaltung AG')
    expect(je.get('Zuschlag an')).toContain('Ettingen')
    expect(je.get('Zuschlag an')).toContain("616'183.15")
    expect(je.get('Eingegangene Angebote')).toBe('6')
    expect(je.get('Zuschlagsdatum')).toBe('2025-11-04')
    expect(je.get('Begruendung des Zuschlags')).toContain(
      'wirtschaftlich günstigste'
    )
    expect(je.get('Kategorie (CPV)')).toContain('Bauarbeiten')
  })

  it('renders a tender with its description and its deadlines', async () => {
    const angaben = angabenAusDetail(
      await fixture('detail-ausschreibung.json'),
      'tender'
    )
    const je = new Map(angaben.map((a) => [a.bezeichnung, a.wert]))

    expect(je.get('Art der Beschaffung')).toBe('Ausschreibung')
    expect(je.get('Verfahren')).toBe('offenes Verfahren')
    // The description arrives as real HTML and must reach the prompt as prose.
    expect(je.get('Beschreibung')).toContain('Innentüren')
    expect(je.get('Beschreibung')).not.toContain('<p>')
    expect(je.get('Eingabefrist fuer Angebote')).toBe('2026-10-12')
    expect(je.get('Frist fuer Fragen')).toBe('2026-09-10')
  })

  it('never invents a label for a field the publication does not carry', () => {
    const angaben = angabenAusDetail({ 'project-info': {} }, 'award')
    expect(angaben.every((a) => a.wert.trim() !== '')).toBe(true)
  })

  it('is empty rather than throwing for a detail that is not one', () => {
    expect(angabenAusDetail(null, 'award')).toEqual([])
    expect(angabenAusDetail('kaputt', 'tender')).toEqual([])
  })
})
