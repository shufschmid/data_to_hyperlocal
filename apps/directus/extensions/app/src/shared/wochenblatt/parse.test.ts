import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findePdfLink,
  istNeuer,
  normalisiereSchluessel,
  nummerAusDateiname,
  parseArchiv,
  parseDeutschesDatum,
  parseLokalzeitungen,
  waehleNeueAusgaben,
  type ArchivEintrag
} from './parse'

// The real archive page of the Binninger Wochenblatt, saved 2026-08-25. It
// carries every irregularity this parser exists for: `_v2` and `-2` slug
// suffixes, double issues ("KW30/31"), and weeks that simply do not exist.
const FIXTURE = readFileSync(
  join(__dirname, 'fixtures', 'binningen-archiv.html'),
  'utf8'
)
const BASIS = 'https://www.binninger-wochenblatt.ch/archiv/'

function eintrag(ueber: Partial<ArchivEintrag>): ArchivEintrag {
  return {
    slug: 'bwb-kw34-2026',
    schluessel: 'kw34-2026',
    nummer: '34',
    datum: '2026-08-20',
    seiteUrl: 'https://www.binninger-wochenblatt.ch/bwb-kw34-2026/',
    kw: 34,
    jahr: 2026,
    ...ueber
  }
}

describe('parseArchiv', () => {
  const archiv = parseArchiv(FIXTURE, BASIS)

  it('findet alle Ausgaben in Quellreihenfolge, neueste zuerst', () => {
    expect(archiv.length).toBeGreaterThan(20)
    expect(archiv[0]?.schluessel).toBe('kw34-2026')
    expect(archiv[1]?.schluessel).toBe('kw33-2026')
  })

  it('liest Nummer und Datum aus dem Linktext', () => {
    const kw34 = archiv[0]
    expect(kw34?.nummer).toBe('34')
    expect(kw34?.datum).toBe('2026-08-20')
  })

  it('behaelt bei Doppelnummern beide Wochen im Nummerntext', () => {
    // "Ausgabe KW30/31 - 23. Juli 2026" — die Attribution braucht die
    // gedruckte Form, die Ordnung nur die erste Woche.
    const doppel = archiv.find((a) => a.schluessel === 'kw30-2026')
    expect(doppel?.nummer).toBe('30/31')
    expect(doppel?.datum).toBe('2026-07-23')
    expect(doppel?.kw).toBe(30)
  })

  it('normalisiert Slug-Unfaelle zur selben Identitaet', () => {
    // Das Archiv ersetzt kaputte Uploads mit "_v2"-Slugs — dieselbe Ausgabe.
    const v2 = archiv.find((a) => a.slug === 'bwb-kw26-2026_v2')
    expect(v2?.schluessel).toBe('kw26-2026')
  })

  it('laesst fremde Links und Navigation aus', () => {
    for (const a of archiv) {
      expect(a.slug).toMatch(/kw\d/i)
      expect(new URL(a.seiteUrl).host).toBe('www.binninger-wochenblatt.ch')
    }
  })
})

describe('normalisiereSchluessel', () => {
  it('streift Versions- und Zaehlsuffixe ab', () => {
    expect(normalisiereSchluessel('bwb-kw26-2026_v2')?.schluessel).toBe(
      'kw26-2026'
    )
    expect(normalisiereSchluessel('bwb-kw19-2026-2')?.schluessel).toBe(
      'kw19-2026'
    )
    expect(normalisiereSchluessel('bwb-kw08-2026-2')?.schluessel).toBe(
      'kw08-2026'
    )
  })

  it('gibt fuer Slugs ohne Woche null zurueck', () => {
    expect(normalisiereSchluessel('impressum')).toBeNull()
    expect(normalisiereSchluessel('archiv')).toBeNull()
  })
})

describe('parseDeutschesDatum', () => {
  it('liest deutsche Monatsnamen', () => {
    expect(parseDeutschesDatum('Ausgabe KW34 - 20. August 2026')).toBe(
      '2026-08-20'
    )
    expect(parseDeutschesDatum('5. März 2026')).toBe('2026-03-05')
  })

  it('raet nicht', () => {
    expect(parseDeutschesDatum('Ausgabe KW34')).toBeNull()
  })
})

describe('istNeuer', () => {
  it('vergleicht ueber Jahr, dann Woche', () => {
    expect(istNeuer({ jahr: 2027, kw: 1 }, { jahr: 2026, kw: 52 })).toBe(true)
    expect(istNeuer({ jahr: 2026, kw: 35 }, { jahr: 2026, kw: 34 })).toBe(true)
    expect(istNeuer({ jahr: 2026, kw: 34 }, { jahr: 2026, kw: 34 })).toBe(false)
  })
})

describe('waehleNeueAusgaben', () => {
  const archiv = [
    eintrag({ slug: 'bwb-kw36-2026', schluessel: 'kw36-2026', kw: 36 }),
    eintrag({ slug: 'bwb-kw35-2026', schluessel: 'kw35-2026', kw: 35 }),
    eintrag({}),
    eintrag({ slug: 'bwb-kw33-2026', schluessel: 'kw33-2026', kw: 33 })
  ]

  it('nimmt beim Erstlauf genau die neueste Ausgabe — der Rueckstand bleibt liegen', () => {
    const wahl = waehleNeueAusgaben(archiv, [])
    expect(wahl.map((a) => a.schluessel)).toEqual(['kw36-2026'])
  })

  it('nimmt danach nur Neueres, eine Ausgabe pro Lauf, aelteste zuerst', () => {
    // KW34 ist gespeichert, KW35 und KW36 sind neu — heute ist KW35 dran,
    // morgen heilt sich die Luecke mit KW36 von selbst.
    const wahl = waehleNeueAusgaben(archiv, ['kw34-2026'])
    expect(wahl.map((a) => a.schluessel)).toEqual(['kw35-2026'])
  })

  it('importiert Aelteres nie — auch wenn es unbekannt ist', () => {
    const wahl = waehleNeueAusgaben(archiv, ['kw35-2026'])
    expect(wahl.map((a) => a.schluessel)).toEqual(['kw36-2026'])
    // kw33 und kw34 sind unbekannt, aber aelter als das Gespeicherte.
  })

  it('meldet nichts, wenn nichts Neues da ist', () => {
    expect(waehleNeueAusgaben(archiv, ['kw36-2026'])).toEqual([])
  })

  it('behandelt ein "_v2" einer bekannten Ausgabe nicht als neue Ausgabe', () => {
    const mitV2 = [
      eintrag({ slug: 'bwb-kw34-2026_v2', schluessel: 'kw34-2026' }),
      ...archiv.slice(3)
    ]
    expect(waehleNeueAusgaben(mitV2, ['kw34-2026'])).toEqual([])
  })
})

// The second connector: the Riehener Zeitung on lokalzeitungen.ch, saved
// 2026-08-26. The landing page links exactly ONE issue (the current one);
// the issue page links the paywall-free PDF from its title.
const RZ_START = readFileSync(
  join(__dirname, 'fixtures', 'riehen-lokalzeitungen-start.html'),
  'utf8'
)
const RZ_AUSGABE = readFileSync(
  join(__dirname, 'fixtures', 'riehen-lokalzeitungen-ausgabe.html'),
  'utf8'
)
const RZ_BASIS = 'https://www.lokalzeitungen.ch/riehener-zeitung/'

describe('parseLokalzeitungen', () => {
  it('findet die aktuelle Ausgabe mit Datum als Identitaet', () => {
    const archiv = parseLokalzeitungen(RZ_START, RZ_BASIS)

    expect(archiv).toHaveLength(1)
    expect(archiv[0]?.schluessel).toBe('2026-08-21')
    expect(archiv[0]?.datum).toBe('2026-08-21')
    expect(archiv[0]?.seiteUrl).toBe(
      'https://www.lokalzeitungen.ch/ausgabe/riehener-zeitung-21-08-2026/'
    )
    // Die gedruckte Nummer steht nicht auf dieser Seite — sie kommt spaeter
    // aus dem Dateinamen des PDFs.
    expect(archiv[0]?.nummer).toBeNull()
  })
})

describe('findePdfLink', () => {
  it('findet den paywall-freien Titel-Link aufs PDF', () => {
    expect(findePdfLink(RZ_AUSGABE, RZ_BASIS)).toBe(
      'https://www.lokalzeitungen.ch/wp-content/uploads/2026/08/RZ-KW34-2026.pdf'
    )
  })

  it('gibt null zurueck, wenn kein PDF verlinkt ist', () => {
    expect(
      findePdfLink('<a href="/impressum/">Impressum</a>', RZ_BASIS)
    ).toBeNull()
  })
})

describe('nummerAusDateiname', () => {
  it('liest die gedruckte Nummer aus dem PDF-Dateinamen', () => {
    expect(
      nummerAusDateiname(
        'https://www.lokalzeitungen.ch/wp-content/uploads/2026/08/RZ-KW34-2026.pdf'
      )
    ).toBe('34')
  })

  it('raet nicht, wenn der Dateiname nichts sagt', () => {
    expect(
      nummerAusDateiname('https://example.ch/zeitung-august.pdf')
    ).toBeNull()
  })
})

describe('waehleNeueAusgaben mit Datums-Schluesseln', () => {
  const eintragRz = (iso: string): ArchivEintrag => {
    const kanon = normalisiereSchluessel(iso)
    if (kanon === null) throw new Error('Fixture kaputt')
    return {
      slug: `riehener-zeitung-${iso.slice(8)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`,
      schluessel: kanon.schluessel,
      nummer: null,
      datum: iso,
      seiteUrl: `https://www.lokalzeitungen.ch/ausgabe/x-${iso}/`,
      kw: kanon.kw,
      jahr: kanon.jahr
    }
  }

  it('nimmt beim Erstlauf die aktuelle Ausgabe', () => {
    expect(
      waehleNeueAusgaben([eintragRz('2026-08-21')], []).map((a) => a.schluessel)
    ).toEqual(['2026-08-21'])
  })

  it('erkennt Neueres am Datum und Altes bleibt liegen', () => {
    expect(
      waehleNeueAusgaben([eintragRz('2026-08-28')], ['2026-08-21']).map(
        (a) => a.schluessel
      )
    ).toEqual(['2026-08-28'])
    expect(
      waehleNeueAusgaben([eintragRz('2026-08-21')], ['2026-08-21'])
    ).toEqual([])
    expect(
      waehleNeueAusgaben([eintragRz('2026-08-14')], ['2026-08-21'])
    ).toEqual([])
  })

  it('vergleicht ueber den Jahreswechsel korrekt', () => {
    expect(
      waehleNeueAusgaben([eintragRz('2027-01-08')], ['2026-12-18']).map(
        (a) => a.schluessel
      )
    ).toEqual(['2027-01-08'])
  })
})
