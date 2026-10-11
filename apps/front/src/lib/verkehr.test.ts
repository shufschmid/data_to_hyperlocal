import type {
  AlleMeldungFelder,
  GeschwindigkeitskontrolleFelder,
  RadarstandortFelder
} from '@/graphql/redaktion'
import {
  alsBilanz,
  bilanzText,
  datumLang,
  meisteText,
  ordneMonate,
  ordneStandorte,
  schnellsterText,
  standortDetails,
  standortTitel,
  zaehlerVerkehr
} from './verkehr'

const standort = (ueber: Partial<RadarstandortFelder>): RadarstandortFelder => ({
  id: 's-1',
  art: 'semistationaer',
  kennung: 'SEMI 03',
  ab_wann: '2026-09-18',
  standort: '4123 Allschwil, Binningerstrasse',
  plz: '4123',
  ort: 'Allschwil',
  strasse: 'Binningerstrasse',
  geschwindigkeit: 50,
  oertlichkeit: 'Ein- / Ausfahrten',
  gemeinde: { id: 'g-allschwil', name: 'Allschwil' },
  aktiv: true,
  erstmals_gesehen: '2026-10-11',
  zuletzt_gesehen: '2026-10-11',
  publikation_am: '2026-10-07',
  quelle_url: 'https://bl-api.webcloud7.ch/x.pdf',
  vorschlag: true,
  vorschlag_begruendung: 'Neue semistationaere Anlage in Allschwil.',
  ...ueber
})

const meldung = (ueber: Partial<AlleMeldungFelder>): AlleMeldungFelder =>
  ({
    id: 'm-1',
    status: 'entwurf',
    radarstandort: null,
    geschwindigkeitskontrolle: null,
    ...ueber
  }) as AlleMeldungFelder

const BILANZ = {
  kontrollen: 9,
  gemessen: 738,
  uebertretungen: 157,
  quote: 21.3,
  meiste: { messort: 'Hinterkirchweg', uebertretungen: 35, gemessen: 99, quote: 35.4 },
  schnellster: {
    vmax: 48,
    signalisiert: 30,
    messort: 'Hinterlindenweg',
    datum: '2026-09-08',
    von: '07:12',
    bis: '08:48'
  }
}

const monat = (ueber: Partial<GeschwindigkeitskontrolleFelder>): GeschwindigkeitskontrolleFelder => ({
  id: 'k-9',
  jahr: 2026,
  monat: 9,
  stand: '2026-09-29',
  polizei: 'Gemeindepolizei Reinach',
  bilanz: BILANZ,
  hinweise: null,
  quelle_url: 'https://www.reinach-bl.ch/r/009-September-2026.pdf',
  gemeinde: { id: 'g-reinach', name: 'Reinach' },
  ...ueber
})

describe('Beschriftung', () => {
  it('schreibt Datum, Standort und Eckdaten aus', () => {
    expect(datumLang('2026-09-18')).toBe('18. September 2026')
    expect(datumLang(null)).toBeNull()
    expect(standortTitel(standort({}))).toBe('Binningerstrasse, Allschwil')
    expect(standortTitel(standort({ strasse: null, ort: null, standort: 'A2/A3 Augst' }))).toBe('A2/A3 Augst')
    expect(standortDetails(standort({}))).toBe('semistationär · SEMI 03 · 50 km/h · ab 18. September 2026')
    expect(standortDetails(standort({ art: 'stationaer', kennung: null, ab_wann: null }))).toBe(
      'stationär · 50 km/h'
    )
  })

  it('liest die gespeicherte Bilanz geprueft und beschriftet sie', () => {
    const b = alsBilanz(BILANZ)
    expect(b).not.toBeNull()
    expect(bilanzText(b!)).toBe('9 Kontrollen · 738 Fahrzeuge · 157 Übertretungen (21,3 %)')
    expect(meisteText(b!)).toBe('Meiste Übertretungen: Hinterkirchweg, 35 von 99 (35,4 %)')
    expect(schnellsterText(b!)).toBe(
      'Schnellstes Fahrzeug: 48 km/h bei 30 km/h, Hinterlindenweg, 8. September 2026, 07:12–08:48 Uhr'
    )
    expect(alsBilanz(null)).toBeNull()
    expect(alsBilanz({ kontrollen: 'neun' })).toBeNull()
  })
})

describe('ordneStandorte', () => {
  // Neu in einer bespielten Gemeinde und ohne Meldung: der Tisch. Mit
  // Meldung: bespielt. Ohne Gemeinde oder nicht mehr auf dem Blatt: andere.
  it('stapelt Vorschlaege, bespielte Anlagen und die anderen des Kantons', () => {
    const standorte = [
      standort({}),
      standort({
        id: 's-2',
        standort: '4102 Binningen, Bottmingerstrasse',
        gemeinde: { id: 'g-b', name: 'Binningen' },
        vorschlag: false
      }),
      standort({ id: 's-3', standort: '4302 Augst, A3', gemeinde: null, vorschlag: false }),
      standort({ id: 's-4', standort: '4410 Liestal, Rheinstrasse', aktiv: false, vorschlag: true }),
      standort({ id: 's-5', standort: '4147 Aesch, Hauptstrasse', gemeinde: { id: 'g-a', name: 'Aesch' } })
    ]
    const meldungen = [meldung({ radarstandort: { id: 's-5' } })]
    const gruppen = ordneStandorte(standorte, meldungen)
    expect(gruppen.vorschlaege.map((e) => e.standort.id)).toEqual(['s-1'])
    expect(gruppen.bespielt.map((e) => [e.standort.id, e.meldung?.id ?? null])).toEqual([
      ['s-2', null],
      ['s-5', 'm-1']
    ])
    expect(gruppen.andere.map((z) => z.id)).toEqual(['s-3', 's-4'])
  })

  it('eine verworfene Meldung zaehlt nicht — der Vorschlag steht wieder', () => {
    const gruppen = ordneStandorte(
      [standort({})],
      [meldung({ radarstandort: { id: 's-1' }, status: 'verworfen' })]
    )
    expect(gruppen.vorschlaege).toHaveLength(1)
  })
})

describe('ordneMonate und zaehlerVerkehr', () => {
  it('ordnet die Monate neueste zuerst, mit Bilanz und Meldung', () => {
    const liste = ordneMonate(
      [monat({ id: 'k-8', monat: 8 }), monat({}), monat({ id: 'k-3', monat: 3, bilanz: null })],
      [meldung({ geschwindigkeitskontrolle: { id: 'k-8' } })]
    )
    expect(liste.map((e) => [e.monat.id, e.bilanz !== null, e.meldung?.id ?? null])).toEqual([
      ['k-9', true, null],
      ['k-8', true, 'm-1'],
      ['k-3', false, null]
    ])
  })

  // Sieben Monate Rueckstand beim ersten Lesen sind Archiv, keine Arbeit:
  // nur die neuesten zwei je Gemeinde zaehlen, dazu jede neue Anlage.
  it('zaehlt neue Anlagen und die neuesten zwei Monate ohne Meldung', () => {
    const monate = [3, 4, 5, 6, 7, 8, 9].map((m) => monat({ id: `k-${m}`, monat: m }))
    expect(zaehlerVerkehr([standort({})], monate, [])).toBe(3)
    expect(
      zaehlerVerkehr([standort({})], monate, [meldung({ geschwindigkeitskontrolle: { id: 'k-9' } })])
    ).toBe(2)
    expect(zaehlerVerkehr([], [], [])).toBe(0)
  })
})
