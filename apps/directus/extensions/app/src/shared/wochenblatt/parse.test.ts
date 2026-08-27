import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  entspreizeVersalien,
  findeIssuuPublicationId,
  findeLocalpointPdf,
  findePdfLink,
  istNeuer,
  normalisiereSchluessel,
  nummerAusDateiname,
  nummerAusErsterSeite,
  parseArchiv,
  parseDeutschesDatum,
  parseIssuuEpaper,
  parseLocalpointEpaper,
  parseLokalzeitungen,
  seitenLink,
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

// The third connector: the Wochenblatt für das Birseck, whose e-paper page
// lists issuu readers. Saved 2026-08-27; the slugs carry number and date, a
// double issue reads `30-31_20260723_…`.
const WOB_EPAPER = readFileSync(
  join(__dirname, 'fixtures', 'birseck-epaper.html'),
  'utf8'
)
const WOB_DOKUMENT = readFileSync(
  join(__dirname, 'fixtures', 'birseck-issuu-dokument.html'),
  'utf8'
)

describe('parseIssuuEpaper', () => {
  const archiv = parseIssuuEpaper(WOB_EPAPER)

  it('findet die Ausgaben in Quellreihenfolge, neueste zuerst', () => {
    expect(archiv.length).toBeGreaterThan(5)
    expect(archiv[0]?.schluessel).toBe('kw35-2026')
    expect(archiv[1]?.schluessel).toBe('kw34-2026')
  })

  it('liest Nummer und Datum aus dem Slug', () => {
    expect(archiv[0]?.nummer).toBe('35')
    expect(archiv[0]?.datum).toBe('2026-08-27')
    expect(archiv[0]?.jahr).toBe(2026)
    expect(archiv[0]?.kw).toBe(35)
  })

  it('erzwingt https und streift die Embed-Query ab', () => {
    // Die Listenseite verlinkt `http://…?mode=embed&layout=white`; die
    // Quelle-Zeile braucht die nackte Reader-Adresse.
    expect(archiv[0]?.seiteUrl).toBe(
      'https://issuu.com/az-anzeiger/docs/35_20260827_woz_wobanz'
    )
  })

  it('behaelt bei Doppelnummern beide Wochen im Nummerntext', () => {
    const doppel = archiv.find((a) => a.schluessel === 'kw30-2026')
    expect(doppel?.nummer).toBe('30/31')
    expect(doppel?.datum).toBe('2026-07-23')
    expect(doppel?.kw).toBe(30)
  })

  it('laesst fremde Links aus und dedupliziert', () => {
    const slugs = archiv.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const a of archiv) {
      // Auch hier gibt es Slug-Unfaelle (`…_woz_wobanz-7`) — die Identitaet
      // traegt der Prefix aus Nummer und Datum, nicht das Suffix.
      expect(a.slug).toMatch(/^\d{1,2}(-\d{1,2})?_20\d{6}_/)
    }
  })
})

describe('findeIssuuPublicationId', () => {
  it('liest die publicationId aus dem Script-Payload der Dokumentseite', () => {
    expect(findeIssuuPublicationId(WOB_DOKUMENT)).toBe(
      'e88edd6aec66678064079d93a578d934'
    )
  })

  it('gibt null zurueck, wenn die Seite keine traegt', () => {
    expect(findeIssuuPublicationId('<html>Seite ohne Reader</html>')).toBeNull()
  })
})

describe('entspreizeVersalien', () => {
  it('entsperrt buchstabengesperrte Rubrik-Koepfe zu Gemeindenamen', () => {
    // Genau die Form, in der das Wochenblatt fuer das Birseck seine Rubriken
    // in den Textlayer schreibt — hier scheiterte die Gemeinde-Zuordnung.
    expect(entspreizeVersalien('WochenBlatt R E I N AC H ANZEIGE')).toContain(
      'REINACH'
    )
    expect(
      entspreizeVersalien('M Ü NC H E N S T E I N Die Stiftung Hofmatt')
    ).toBe('MÜNCHENSTEIN Die Stiftung Hofmatt')
    expect(
      entspreizeVersalien('A E S C H U N D PF E F F I NGE N MITTEILUNGEN')
    ).toContain('AESCHUNDPFEFFINGEN')
    expect(
      entspreizeVersalien('D OR N AC H U N D D OR N E C K BE RG WochenBlatt')
    ).toContain('DORNACHUNDDORNECKBERG')
  })

  it('laesst Fliesstext und einzelne Abkuerzungen unangetastet', () => {
    const text = 'Fliesstext mit Michael Klaiber, die BLT und die ABB AG.'
    expect(entspreizeVersalien(text)).toBe(text)
  })
})

describe('seitenLink', () => {
  it('haengt bei PDFs das Viewer-Fragment an', () => {
    expect(seitenLink('https://example.ch/zeitung.pdf', 3)).toBe(
      'https://example.ch/zeitung.pdf#page=3'
    )
  })

  it('haengt bei issuu-Readern die Seite als Pfadsegment an', () => {
    expect(
      seitenLink(
        'https://issuu.com/az-anzeiger/docs/35_20260827_woz_wobanz',
        19
      )
    ).toBe('https://issuu.com/az-anzeiger/docs/35_20260827_woz_wobanz/19')
  })
})

describe('waehleNeueAusgaben mit issuu-Eintraegen', () => {
  const archiv = parseIssuuEpaper(WOB_EPAPER)

  it('nimmt beim Erstlauf genau die neueste Ausgabe', () => {
    expect(waehleNeueAusgaben(archiv, []).map((a) => a.schluessel)).toEqual([
      'kw35-2026'
    ])
  })

  it('erkennt Neueres an der Woche im Slug', () => {
    expect(
      waehleNeueAusgaben(archiv, ['kw34-2026']).map((a) => a.schluessel)
    ).toEqual(['kw35-2026'])
    expect(waehleNeueAusgaben(archiv, ['kw35-2026'])).toEqual([])
  })
})

// The fourth connector: the BiBo (Birsigtal-Bote) on Localpoint's CMS, saved
// 2026-08-27. The listing page embeds its issues as JSON; the reader page
// carries the blitzbucket iframe the PDF address is derived from.
const BIBO_EPAPER = readFileSync(
  join(__dirname, 'fixtures', 'bibo-epaper.html'),
  'utf8'
)
const BIBO_READER = readFileSync(
  join(__dirname, 'fixtures', 'bibo-reader.html'),
  'utf8'
)

describe('parseLocalpointEpaper', () => {
  const archiv = parseLocalpointEpaper(BIBO_EPAPER, 'https://bibo.ch/epaper')

  it('liest die eingebettete Ausgabenliste, neueste zuerst', () => {
    expect(archiv.length).toBeGreaterThan(100)
    expect(archiv[0]?.schluessel).toBe('2026-08-27')
    expect(archiv[0]?.datum).toBe('2026-08-27')
    expect(archiv[1]?.schluessel).toBe('2026-08-20')
  })

  it('baut die Reader-Adresse aus Jahr, Datum und unique_id', () => {
    expect(archiv[0]?.seiteUrl).toBe(
      'https://bibo.ch/bcms/read_epaper?id=2026/2026-08-27-9228fa61-cee0-4be7-9e73-0b5c4a5c81cf'
    )
    // Die gedruckte Nummer steht nicht in der Liste — sie kommt spaeter von
    // der Frontseite des PDFs.
    expect(archiv[0]?.nummer).toBeNull()
  })

  it('gibt fuer Seiten ohne eingebettete Liste eine leere Liste zurueck', () => {
    expect(
      parseLocalpointEpaper('<html></html>', 'https://bibo.ch/epaper')
    ).toEqual([])
  })
})

describe('findeLocalpointPdf', () => {
  it('leitet die PDF-Adresse aus den Koordinaten des Reader-iframes ab', () => {
    expect(findeLocalpointPdf(BIBO_READER)).toBe(
      'https://files.localpoint.ch/pdf/bib/2026/2026-08-27-9228fa61-cee0-4be7-9e73-0b5c4a5c81cf.pdf'
    )
  })

  it('gibt null zurueck, wenn kein Reader-iframe da ist', () => {
    expect(findeLocalpointPdf('<html>nichts</html>')).toBeNull()
  })
})

describe('nummerAusErsterSeite', () => {
  it('liest die gedruckte Nummer aus dem Kopf der Frontseite', () => {
    expect(
      nummerAusErsterSeite(
        'AMTLICHER ANZEIGER FÜR DAS BIRSIGTAL GZA 2012 BASEL | BIBO NR. 35 | 82. JAHRGANG'
      )
    ).toBe('35')
  })

  it('raet nicht, wenn die Frontseite nichts sagt', () => {
    expect(nummerAusErsterSeite('Eine Seite ohne Nummer im Kopf.')).toBeNull()
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
