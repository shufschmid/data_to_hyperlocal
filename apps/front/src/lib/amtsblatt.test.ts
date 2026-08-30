import type { AmtsblattFelder, GemeindeFelder } from '@/graphql/redaktion'
import {
  anzahlOffen,
  bleibtAufDemTisch,
  datumText,
  gruppenText,
  kannUnterlagenLesen,
  karte,
  ohnePlz,
  passt,
  sortiere,
  tageBisFrist,
  tisch,
  unterlage
} from './amtsblatt'

function eintrag(ueber: Partial<AmtsblattFelder> = {}): AmtsblattFelder {
  return {
    id: 'a',
    publikations_id: 'p',
    publikationsnummer: null,
    kanton: 'BL',
    gruppe: 'bauen',
    rubrik_name: 'Baugesuch',
    titel: 'Baugesuch - Solaranlage, Aesch',
    publiziert_am: '2026-08-27',
    frist: null,
    amt: 'Bauinspektorat',
    pdf_url: 'https://amtsblattportal.ch/api/v1/publications/p/pdf',
    angaben: null,
    unterlagen: null,
    planbefunde: null,
    plan_status: 'offen',
    plan_fazit: null,
    vorschlag: null,
    vorschlag_begruendung: null,
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: { id: 'g1', name: 'Aesch' },
    ...ueber
  }
}

const OHNE_FILTER = { gemeinde: null, gruppe: null, suche: '' }

describe('bleibtAufDemTisch', () => {
  // Finished work leaves the view immediately, exactly as in the press review.
  // The rows stay in the database — they are this feed's memory.
  it('laesst nur Unentschiedenes liegen', () => {
    expect(bleibtAufDemTisch(eintrag({ entscheid: 'offen' }))).toBe(true)
    for (const entscheid of ['uebernommen', 'abgelehnt', 'weitergereicht']) {
      expect(bleibtAufDemTisch(eintrag({ entscheid }))).toBe(false)
    }
  })

  it('zaehlt fuer das Reiter-Abzeichen, was noch wartet', () => {
    expect(anzahlOffen([eintrag({ id: '1' }), eintrag({ id: '2', entscheid: 'abgelehnt' })])).toBe(1)
  })
})

describe('sortiere', () => {
  // The deadline leads because it is the only thing here that expires.
  it('stellt Fristen nach vorne, die naechste zuerst', () => {
    const sortiert = sortiere([
      eintrag({ id: 'ohne', frist: null, publiziert_am: '2026-08-29' }),
      eintrag({ id: 'spaet', frist: '2026-09-20' }),
      eintrag({ id: 'bald', frist: '2026-09-02' })
    ])

    expect(sortiert.map((e) => e.id)).toEqual(['bald', 'spaet', 'ohne'])
  })

  it('sortiert Fristlose nach Datum, neuste zuerst', () => {
    const sortiert = sortiere([
      eintrag({ id: 'alt', publiziert_am: '2026-08-01' }),
      eintrag({ id: 'neu', publiziert_am: '2026-08-29' })
    ])

    expect(sortiert.map((e) => e.id)).toEqual(['neu', 'alt'])
  })
})

describe('tisch', () => {
  // The triage sorts, it does not filter — that is what keeps the desk honest
  // at a measured 12 to 23 publications a day.
  it('legt Vorschlaege oben und behaelt alles andere', () => {
    const { vorschlaege, uebrige } = tisch(
      [
        eintrag({ id: 'ja', vorschlag: true }),
        eintrag({ id: 'nein', vorschlag: false }),
        eintrag({ id: 'unbeurteilt', vorschlag: null })
      ],
      OHNE_FILTER
    )

    expect(vorschlaege.map((e) => e.id)).toEqual(['ja'])
    expect(uebrige.map((e) => e.id).sort()).toEqual(['nein', 'unbeurteilt'])
  })

  // `vorschlag: null` is "not judged", not "no" — it must not be promoted.
  it('haelt Unbeurteiltes bei den Uebrigen', () => {
    const { vorschlaege } = tisch([eintrag({ vorschlag: null })], OHNE_FILTER)

    expect(vorschlaege).toHaveLength(0)
  })

  it('laesst Entschiedenes ganz weg', () => {
    const { vorschlaege, uebrige } = tisch(
      [eintrag({ vorschlag: true, entscheid: 'uebernommen' })],
      OHNE_FILTER
    )

    expect(vorschlaege).toHaveLength(0)
    expect(uebrige).toHaveLength(0)
  })
})

describe('passt', () => {
  it('filtert nach Gemeinde und Art', () => {
    const e = eintrag()

    expect(passt(e, { ...OHNE_FILTER, gemeinde: 'g1' })).toBe(true)
    expect(passt(e, { ...OHNE_FILTER, gemeinde: 'g2' })).toBe(false)
    expect(passt(e, { ...OHNE_FILTER, gruppe: 'bauen' })).toBe(true)
    expect(passt(e, { ...OHNE_FILTER, gruppe: 'wirtschaft' })).toBe(false)
  })

  it('sucht in Titel, Rubrik, Amt und Gemeinde — auch ohne Umlaut', () => {
    const e = eintrag({ titel: 'Baugesuch Münchenstein', gemeinde: { id: 'g', name: 'Münchenstein' } })

    expect(passt(e, { ...OHNE_FILTER, suche: 'munchenstein' })).toBe(true)
    expect(passt(e, { ...OHNE_FILTER, suche: 'bauinspektorat' })).toBe(true)
    expect(passt(e, { ...OHNE_FILTER, suche: 'volleyball' })).toBe(false)
  })
})

describe('Unterlagen', () => {
  const plaene = { art: 'plaene', bezeichnung: 'Baugesuchsplaene', url: 'p', lesbar: true }
  const lage = { art: 'karte', bezeichnung: 'Karte', url: 'k', lesbar: false }
  const ebau = { art: 'ebau', bezeichnung: 'eBau', url: 'e', lesbar: false }

  // The map link is orientation for the editor, never "the documents".
  it('nimmt Plaene vor eBau und nie die Karte', () => {
    expect(unterlage(eintrag({ unterlagen: [lage, ebau, plaene] }))?.art).toBe('plaene')
    expect(unterlage(eintrag({ unterlagen: [lage, ebau] }))?.art).toBe('ebau')
    expect(unterlage(eintrag({ unterlagen: [lage] }))).toBeNull()
    expect(karte(eintrag({ unterlagen: [lage] }))).toBe('k')
  })

  // Only Baselland publishes its plans as plain images. Elsewhere the link
  // stays and the button does not appear, rather than appearing and failing.
  it('bietet das Lesen nur an, wo etwas Lesbares dranhaengt', () => {
    expect(kannUnterlagenLesen(eintrag({ unterlagen: [plaene] }))).toBe(true)
    expect(kannUnterlagenLesen(eintrag({ unterlagen: [ebau, lage] }))).toBe(false)
    expect(kannUnterlagenLesen(eintrag({ unterlagen: null }))).toBe(false)
  })

  it('bietet es nicht noch einmal an, waehrend gelesen wird oder danach', () => {
    expect(kannUnterlagenLesen(eintrag({ unterlagen: [plaene], plan_status: 'liest' }))).toBe(false)
    expect(kannUnterlagenLesen(eintrag({ unterlagen: [plaene], plan_status: 'gelesen' }))).toBe(false)
    expect(kannUnterlagenLesen(eintrag({ unterlagen: [plaene], plan_status: 'fehler' }))).toBe(true)
  })
})

describe('ohnePlz', () => {
  function gemeinde(ueber: Partial<GemeindeFelder>): GemeindeFelder {
    return { id: 'g', name: 'Ort', bezirk: 'Arlesheim', bfs_nummer: 1, plz: null, aktiv: true, ...ueber }
  }

  // Without a postcode the portal simply returns nothing for the SHAB half,
  // and an absence is indistinguishable from "nothing was published".
  it('nennt die bespielten Gemeinden ohne Postleitzahl', () => {
    const fehlend = ohnePlz([
      gemeinde({ id: 'a', name: 'Aesch', plz: ['4147'] }),
      gemeinde({ id: 'b', name: 'Dornach', plz: [] }),
      gemeinde({ id: 'c', name: 'Riehen', plz: null }),
      gemeinde({ id: 'd', name: 'Therwil', plz: null, aktiv: false })
    ])

    expect(fehlend.map((g) => g.name)).toEqual(['Dornach', 'Riehen'])
  })
})

describe('Darstellung', () => {
  it('schreibt Daten absolut aus', () => {
    expect(datumText('2026-09-07')).toBe('7. September 2026')
    expect(datumText(null)).toBe('')
  })

  it('rechnet die Tage bis zur Frist, auch rueckwaerts', () => {
    expect(tageBisFrist('2026-09-07', '2026-08-31')).toBe(7)
    expect(tageBisFrist('2026-08-29', '2026-08-31')).toBe(-2)
    expect(tageBisFrist(null, '2026-08-31')).toBeNull()
  })

  it('benennt die Gruppen, auch die unbekannte', () => {
    expect(gruppenText('bauen')).toBe('Bauen, Planung, Verkehr')
    expect(gruppenText('personen')).toBe('Konkurse & Betreibungen')
    expect(gruppenText(null)).toBe('Übriges')
  })
})
