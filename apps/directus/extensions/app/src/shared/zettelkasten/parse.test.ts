import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  nurOrganisationen,
  parseTreffer,
  rubrikVon,
  ZettelkastenFehler,
  type Vorgeschichte
} from './parse'

// The fixture is a real answer of the Zettelkasten's REST door, fetched on
// 16 September 2026 (`publikation_suche?suche=ARA OR Mobilfunkantenne&
// rubrik=BP-BL05&von=2026-08-01&grenze=3`). Both rows are decisions on
// installations — a sewage plant and a mobile mast — so the fixture names no
// natural person. That was checked by reading it, not by a rule: a fixture is
// committed forever, and a private name in one cannot be taken back.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf-8'))
}

function treffer(rubrik: string, titel = 'Eine Publikation'): Vorgeschichte {
  return {
    publikationsnummer: `${rubrik}-0000000001`,
    datum: '2026-09-10',
    rubrik,
    titel,
    adresse: null,
    gemeindeBfs: null
  }
}

describe('parseTreffer', () => {
  it('reads the real answer of the door', async () => {
    const ergebnis = parseTreffer(await fixture('publikation_suche.json'))

    expect(ergebnis.treffer).toHaveLength(2)
    expect(ergebnis.gesamt).toBe(2)
    expect(ergebnis.weitere).toBe(false)

    const ara = ergebnis.treffer.find((t) => t.titel.includes('ARA Rhein'))
    expect(ara?.publikationsnummer).toBe('BP-BL05-0000006774')
    expect(ara?.datum).toBe('2026-08-06')
    expect(ara?.rubrik).toBe('BP-BL05')
    expect(ara?.gemeindeBfs).toBe(2831)
    expect(ara?.adresse).toMatch(
      /^https:\/\/amtsblattportal\.ch\/api\/v1\/publications\/[0-9a-f-]+\/pdf$/
    )
  })

  it('carries the Vorbehalt through unchanged', async () => {
    const ergebnis = parseTreffer(await fixture('publikation_suche.json'))

    // Not a formality. The Zettelkasten proves that a publication appeared
    // under this number with this wording — not that its content is true, and
    // not that a namesake is the same person. The sentence travels with the
    // rows to the desk, so an editor reads it where the rows are read.
    expect(ergebnis.vorbehalt).toContain('Belegt ist')
    expect(ergebnis.vorbehalt.length).toBeGreaterThan(80)
  })

  it('takes a row without address or municipality as it is', () => {
    const ergebnis = parseTreffer({
      gesamt: 1,
      weitere: false,
      vorbehalt: 'Belegt ist: …',
      treffer: [
        {
          titel: 'Baugesuch - Vordach, Niederdorf',
          publikationsnummer: 'BP-BL05-0000006953',
          rubrik: 'BP-BL05',
          datum: '2026-09-10',
          beleg: 'rohablage/amtsblatt_bl/x.json :: BP-BL05-0000006953'
        }
      ]
    })

    expect(ergebnis.treffer[0]?.adresse).toBeNull()
    expect(ergebnis.treffer[0]?.gemeindeBfs).toBeNull()
  })

  it('turns the door’s own error into a ZettelkastenFehler', () => {
    expect(() => parseTreffer({ fehler: 'Die Kanarie ist gefallen.' })).toThrow(
      ZettelkastenFehler
    )
  })

  it('refuses an answer that is not one', () => {
    expect(() => parseTreffer({ treffer: 'viele' })).toThrow(ZettelkastenFehler)
    expect(() => parseTreffer(null)).toThrow(ZettelkastenFehler)
  })
})

describe('rubrikVon', () => {
  it('cuts the number off a sub-rubric', () => {
    expect(rubrikVon('BP-BL05')).toBe('BP-BL')
    expect(rubrikVon('GR-BS10')).toBe('GR-BS')
    expect(rubrikVon('KK01')).toBe('KK')
    expect(rubrikVon('HR02')).toBe('HR')
  })

  it('leaves a rubric without a number alone', () => {
    expect(rubrikVon('AB')).toBe('AB')
    expect(rubrikVon('')).toBe('')
  })
})

describe('nurOrganisationen', () => {
  it('keeps what the desk already collects as a matter of organisations', () => {
    const behalten = nurOrganisationen([
      treffer('BP-BL05', 'Baugesuch - Solaranlage, Allschwil'),
      treffer('HR02', 'Handelsregister-Mutation'),
      treffer('GR-BS10', 'Handaenderung')
    ])

    expect(behalten.map((t) => t.rubrik)).toEqual([
      'BP-BL05',
      'HR02',
      'GR-BS10'
    ])
  })

  it('drops every rubric that names natural persons in a private matter', () => {
    // Bankruptcies, payment orders, estates: the group `personen` in the
    // gazette adapter is exactly this line, and it is drawn there once for the
    // whole newsroom. Drawing a second line here would drift from it.
    const behalten = nurOrganisationen([
      treffer('KK01', 'Konkurseroeffnung'),
      treffer('SB01', 'Schuldenruf'),
      treffer('TE-BL01', 'Testamentseroeffnung'),
      treffer('BP-BL05', 'Baugesuch - Kamin, Itingen')
    ])

    expect(behalten.map((t) => t.rubrik)).toEqual(['BP-BL05'])
  })

  it('drops a rubric it does not know, rather than guessing', () => {
    // An allow-list, not a deny-list. A new rubric at the portal is unknown
    // here, and an unknown rubric may well be a private matter; letting it
    // through would be the silent kind of mistake.
    expect(nurOrganisationen([treffer('ZZ99')])).toEqual([])
  })
})
