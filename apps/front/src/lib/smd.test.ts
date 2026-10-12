import type { SmdBeitragFelder } from '@/graphql/redaktion'
import {
  abgelaufen,
  anzahlOffen,
  beitragsText,
  bleibtAufDemTisch,
  datumText,
  laufText,
  linkChip,
  linkText,
  medien,
  publizierbare,
  tisch,
  weitereGemeinden
} from './smd'

function eintrag(ueber: Partial<SmdBeitragFelder> = {}): SmdBeitragFelder {
  return {
    id: 'a',
    art: 'artikel',
    medium: 'bzbasel.ch',
    datum: '2026-10-10',
    zeit: null,
    blog: null,
    rubrik: 'Gastronomie',
    titel: 'Die Beiz für alle wird zum Restaurant für wenige',
    lead: 'Typische Dorfbeizen gibt es immer weniger.',
    autor: 'Salome Halbeisen',
    text: 'Text.',
    text_abgeschnitten: false,
    seite_von: 1,
    seite_bis: 1,
    gemeinden_genannt: ['Muttenz', 'Arlesheim'],
    link_url: 'https://www.bzbasel.ch/basel/baselland/dorfbeizen-ld.4247727',
    link_status: 'gefunden',
    link_abo: true,
    link_titel: 'Dorfbeizen unter Druck',
    link_hinweis: 'gefunden über sitemap-titel',
    hinweise: null,
    vorschlag: true,
    vorschlag_begruendung: 'Eigene Reportage über eine Beiz in Muttenz.',
    entscheid: 'offen',
    ablehnungsgrund: null,
    date_created: '2026-10-11T14:45:00Z',
    gemeinde: { id: 'g1', name: 'Muttenz' },
    dossier: { id: 'd1', datum: '2026-10-11' },
    ...ueber
  }
}

describe('linkChip und linkText — was die Zeile und die Quellenzeile sagen', () => {
  it('online mit Abo, online frei, von Hand, nicht online mit Grund', () => {
    expect(linkChip(eintrag())).toEqual({ text: 'Online (Abo)', farbe: 'success' })
    expect(linkChip(eintrag({ link_abo: false }))).toEqual({ text: 'Online (frei)', farbe: 'success' })
    expect(linkChip(eintrag({ link_status: 'manuell', link_abo: null })).text).toBe('Online (Abo, von Hand)')
    expect(linkChip(eintrag({ link_url: null, link_status: 'nicht_gefunden' }))).toEqual({
      text: 'Artikel nicht online verfügbar',
      farbe: 'default'
    })
    expect(linkChip(eintrag({ link_url: null, link_status: 'keine_tuer' })).text).toMatch(/keine Verlagstür/)
    expect(linkChip(eintrag({ link_url: null, link_status: 'fehler' })).farbe).toBe('warning')
  })

  it('der Linktext traegt «(Abo)», ausser die Seite meldet den Artikel als frei', () => {
    expect(linkText(eintrag())).toBe('Artikel auf bzbasel.ch (Abo)')
    expect(linkText(eintrag({ link_abo: false }))).toBe('Artikel auf bzbasel.ch')
    expect(linkText(eintrag({ link_url: null }))).toBe('(Artikel nicht online verfügbar)')
  })
})

describe('beitragsText', () => {
  it('nennt Medium und Tag, bei einem Blog-Eintrag den Blog und die Uhrzeit', () => {
    expect(beitragsText(eintrag(), datumText)).toBe('bzbasel.ch, 10. Oktober 2026')
    expect(
      beitragsText(eintrag({ art: 'blogeintrag', blog: 'Regiosport-Aktuell', zeit: '22:28' }), datumText)
    ).toBe('bzbasel.ch, Blog «Regiosport-Aktuell», Eintrag vom 10. Oktober 2026, 22:28 Uhr')
  })
})

describe('der Tisch', () => {
  it('zeigt Vorschlaege oben, das Uebrige gefaltet, Entschiedenes nicht mehr', () => {
    const t = tisch(
      [
        eintrag({ id: 'v' }),
        eintrag({ id: 'u', vorschlag: false }),
        eintrag({ id: 'n', vorschlag: null }),
        eintrag({ id: 'x', entscheid: 'abgelehnt' })
      ],
      { gemeinde: null, medium: null, suche: '' }
    )
    expect(t.vorschlaege.map((e) => e.id)).toEqual(['v'])
    expect(t.uebrige.map((e) => e.id)).toEqual(['u', 'n'])
  })

  it('filtert nach Gemeinde, Medium und Suche', () => {
    const rows = [
      eintrag({ id: 'a' }),
      eintrag({ id: 'b', medium: 'bazonline.ch', titel: 'Waldrain', gemeinde: { id: 'g2', name: 'Riehen' } })
    ]
    expect(tisch(rows, { gemeinde: 'g2', medium: null, suche: '' }).vorschlaege.map((e) => e.id)).toEqual([
      'b'
    ])
    expect(
      tisch(rows, { gemeinde: null, medium: 'bzbasel.ch', suche: '' }).vorschlaege.map((e) => e.id)
    ).toEqual(['a'])
    expect(tisch(rows, { gemeinde: null, medium: null, suche: 'wald' }).vorschlaege.map((e) => e.id)).toEqual(
      ['b']
    )
    expect(medien(rows)).toEqual(['bazonline.ch', 'bzbasel.ch'])
  })

  it('eine uebernommene Zeile bleibt, solange ihre Meldung in Arbeit ist', () => {
    const u = eintrag({ entscheid: 'uebernommen' })
    expect(bleibtAufDemTisch(u, 'entwurf')).toBe(true)
    expect(bleibtAufDemTisch(u, 'publiziert')).toBe(false)
    expect(bleibtAufDemTisch(u, null)).toBe(false)
    expect(anzahlOffen([u, eintrag({ id: 'b', vorschlag: false })], new Map([['a', 'entwurf']]))).toBe(1)
  })

  it('laesst ablaufen, was der Lauf morgen ohnehin aufraeumt', () => {
    expect(abgelaufen(eintrag({ vorschlag: false }), '2026-10-18')).toBe(true)
    expect(abgelaufen(eintrag({ vorschlag: false }), '2026-10-14')).toBe(false)
    expect(abgelaufen(eintrag(), '2026-10-25')).toBe(true)
    expect(abgelaufen(eintrag(), '2026-10-20')).toBe(false)
  })

  it('weitereGemeinden laesst die eigene weg; publizierbare nimmt Entwurf und Freigegebenes', () => {
    expect(weitereGemeinden(eintrag())).toEqual(['Arlesheim'])
    expect(
      publizierbare([
        { smd_beitrag: { id: 'a' }, status: 'entwurf' },
        { smd_beitrag: { id: 'b' }, status: 'in_pruefung' },
        { smd_beitrag: null, status: 'entwurf' },
        { status: 'freigegeben' }
      ])
    ).toHaveLength(1)
  })
})

describe('laufText', () => {
  it('berichtet, was der letzte Lauf brachte', () => {
    expect(
      laufText({
        laeuft: false,
        gestartet_um: '2026-10-12T12:45:00Z',
        beendet_um: '2026-10-12T12:46:30Z',
        ergebnis: { mails: 1, dokumente: 7, neu: 5, links: { gefunden: 3 }, vorschlaege: 2, fehler: [] },
        fehler: null
      })
    ).toMatch(/1 neue Dossiers, 7 Dokumente, 5 neue Beiträge, 3 online gefunden, 2 Vorschläge\.$/)
    expect(
      laufText({ laeuft: true, gestartet_um: null, beendet_um: null, ergebnis: null, fehler: null })
    ).toMatch(/unterwegs/)
  })
})
