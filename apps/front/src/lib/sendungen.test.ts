import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'
import {
  anzahlOffen,
  bleibtOffen,
  HINWEIS_SICHTBAR_TAGE,
  jungeDossiers,
  jungeWiederholungen,
  kandidatenJeEdition,
  meldungJeKandidat,
  ordneEditionen,
  sendungAusBetreff,
  verarbeitungsBericht,
  verarbeitungsergebnis,
  zeitText
} from './sendungen'

function kandidat(ueber: Partial<SendungskandidatFelder> = {}): SendungskandidatFelder {
  return {
    id: 'k1',
    quelle: 'regionaljournal',
    titel: 'Schulhaus wird saniert',
    zusammenfassung: 'Kosten: 4 Millionen.',
    begruendung: 'Betrifft alle Familien im Dorf.',
    zeitmarke_sekunden: 261,
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: { id: 'g1', name: 'Aesch' },
    edition: { id: 'e1' },
    punkt6_edition: null,
    ...ueber
  }
}

describe('bleibtOffen', () => {
  it('laesst Unentschiedenes liegen und Erledigtes gehen', () => {
    expect(bleibtOffen(kandidat())).toBe(true)
    expect(bleibtOffen(kandidat({ entscheid: 'abgelehnt' }))).toBe(false)
    expect(bleibtOffen(kandidat({ entscheid: 'weitergereicht' }))).toBe(false)
  })

  // Dieselbe Regel wie beim Amtsblatt, aus demselben Grund: die Meldung wird
  // auf der Karte redigiert, also muss die Karte den Vorschlag behalten.
  it('haelt einen uebernommenen Vorschlag, solange die Meldung redigiert wird', () => {
    const uebernommen = kandidat({ entscheid: 'uebernommen' })

    expect(bleibtOffen(uebernommen, 'entwurf')).toBe(true)
    expect(bleibtOffen(uebernommen, 'in_pruefung')).toBe(true)
    expect(bleibtOffen(uebernommen, 'publiziert')).toBe(false)
    expect(bleibtOffen(uebernommen, 'verworfen')).toBe(false)
    expect(bleibtOffen(uebernommen, null)).toBe(false)
  })
})

describe('kandidatenJeEdition', () => {
  // Eine Sendung kann mehrere Gemeinden betreffen — darum eine Liste je
  // Beitrag, nicht ein Kandidat.
  it('sammelt mehrere Vorschlaege zum selben Beitrag', () => {
    const karte = kandidatenJeEdition([
      kandidat({ id: 'a', edition: { id: 'e1' } }),
      kandidat({ id: 'b', edition: { id: 'e1' } }),
      kandidat({ id: 'c', edition: { id: 'e2' } })
    ])

    expect(karte.get('e1')?.map((k) => k.id)).toEqual(['a', 'b'])
    expect(karte.get('e2')?.map((k) => k.id)).toEqual(['c'])
  })

  it('ordnet auch die punkt6-Beitraege zu', () => {
    const karte = kandidatenJeEdition([
      kandidat({ id: 'p', quelle: 'punkt6', edition: null, punkt6_edition: { id: 'x1' } })
    ])

    expect(karte.get('x1')?.map((k) => k.id)).toEqual(['p'])
  })

  it('laesst einen Kandidaten ohne Beitrag einfach weg', () => {
    expect(kandidatenJeEdition([kandidat({ edition: null })]).size).toBe(0)
  })
})

describe('anzahlOffen', () => {
  function meldung(ueber: Partial<AlleMeldungFelder>): AlleMeldungFelder {
    return {
      id: 'm1',
      titel: null,
      lead: null,
      text: null,
      status: 'entwurf',
      verarbeitung: 'idle',
      zeit_warnungen: null,
      fehler: null,
      publiziert_am: null,
      publiziert_durch: null,
      termin: null,
      termin_vorschlag: null,
      wichtig: null,
      wichtig_vorschlag: null,
      revision_hinweis: null,
      erscheint_am: null,
      date_created: null,
      gemeinde: null,
      lauf: null,
      spiel: null,
      kandidat: null,
      amtsblattmeldung: null,
      gemeindemitteilung: null,
      veranstaltung: null,
      sendungskandidat: null,
      suedanflugquote: null,
      abstimmung: null,
      perle: null,
      ...ueber
    }
  }

  it('zaehlt Offenes und angefangene Arbeit', () => {
    const kandidaten = [
      kandidat({ id: '1' }),
      kandidat({ id: '2', entscheid: 'abgelehnt' }),
      kandidat({ id: '3', entscheid: 'uebernommen' })
    ]

    expect(anzahlOffen(kandidaten)).toBe(1)
    expect(anzahlOffen(kandidaten, [meldung({ sendungskandidat: { id: '3' } })])).toBe(2)
    expect(anzahlOffen(kandidaten, [meldung({ sendungskandidat: { id: '3' }, status: 'publiziert' })])).toBe(
      1
    )
  })

  it('ordnet die Meldungen ihren Kandidaten zu', () => {
    const karte = meldungJeKandidat([
      meldung({ id: 'm1', sendungskandidat: { id: 'k1' } }),
      meldung({ id: 'm2', sendungskandidat: null })
    ])

    expect(karte.get('k1')?.id).toBe('m1')
    expect(karte.size).toBe(1)
  })
})

describe('zeitText', () => {
  it('macht aus Sekunden die Stelle, die man anspringt', () => {
    expect(zeitText(261)).toBe('4:21')
    expect(zeitText(49)).toBe('0:49')
    expect(zeitText(0)).toBe('0:00')
    expect(zeitText(null)).toBe('')
  })
})

describe('Verarbeitung — was der Knopf berichtet', () => {
  it('liest Status und Grund aus der Antwort', () => {
    expect(verarbeitungsergebnis({ status: 'processed' })).toBe('verarbeitet')
    expect(verarbeitungsergebnis({ status: 'wartet', grund: 'keine_marken' })).toBe('wartet')
    expect(verarbeitungsergebnis({ status: 'wartet', grund: 'passt_nicht' })).toBe('passt_nicht')
    expect(verarbeitungsergebnis({ status: 'wiederholung' })).toBe('wiederholung')
    expect(verarbeitungsergebnis(undefined)).toBe('fehlgeschlagen')
  })

  it('nennt die zwei Arten zu warten und die Wiederholung getrennt', () => {
    expect(verarbeitungsBericht(['wiederholung'], null)).toBe(
      '0 von 1 Dossier verarbeitet, 1 ist eine Wiederholung einer früheren Sendung und wurde nicht noch einmal aufbereitet.'
    )
    expect(verarbeitungsBericht(['verarbeitet', 'wartet', 'passt_nicht'], 3)).toBe(
      '3 Dossiers geholt, 1 verarbeitet, 1 wartet auf die Beitragsmarken von telebasel.ch, bei 1 passen die Beitragsmarken von telebasel.ch nicht zum Transkript (anderer Schnitt als die Sendung).'
    )
  })

  it('findet die Sendung im Betreff des SMD-Mails', () => {
    expect(
      sendungAusBetreff('Resultate für Ihre gespeicherte Recherche: punkt6neu vom 27.09.2026 22:04:48')
    ).toBe('punkt6 vom 27.09.2026')
    expect(sendungAusBetreff('etwas anderes')).toBeNull()
  })

  // Die Regel der Redaktion vom 19.10.2026: eine Wiederholung ist eine
  // unwichtige Statuszeile und steht drei Tage, nicht zwei Wochen.
  it('zeigt nur die Wiederholungen der letzten drei Tage', () => {
    const heute = new Date('2026-09-28T12:00:00Z')
    const d = [
      { id: 'a', date_created: '2026-09-27T20:30:00Z' },
      { id: 'vier-tage', date_created: '2026-09-24T10:00:00Z' },
      { id: 'b', date_created: '2026-09-01T20:30:00Z' },
      { id: 'c', date_created: null }
    ]
    expect(jungeWiederholungen(d, heute).map((x) => x.id)).toEqual(['a'])
  })
})

// Die Regel der Redaktion vom 25.10.2026: Hinweise zu einer gescheiterten
// Sendung sind gut, aber nach fünf Tagen weg. Gemessen an dem Tag: eine
// Regionaljournal-Ausgabe ohne Audio vom 01.10. stand zuoberst, ein
// fehlgeschlagenes punkt6-Dossier vom 14.10. auch.
describe('Hinweise zu gescheiterten Sendungen', () => {
  const heute = new Date(2026, 9, 25, 10, 0)

  it('zeigt nur die offenen Dossiers der letzten fünf Tage', () => {
    const d = [
      { id: 'gestern', date_created: '2026-10-24T20:10:00Z' },
      { id: 'vier-tage', date_created: '2026-10-21T12:35:00Z' },
      { id: 'elf-tage', date_created: '2026-10-14T20:10:00Z' },
      { id: 'ohne', date_created: null }
    ]
    expect(jungeDossiers(d, HINWEIS_SICHTBAR_TAGE, heute).map((x) => x.id)).toEqual(['gestern', 'vier-tage'])
  })

  it('stellt eine Ausgabe ohne Audio nur fünf Tage lang nach oben', () => {
    // So, wie die Abfrage sie liefert: neuester Tag zuerst.
    const editionen = [
      { id: 'heute', broadcast_date: '2026-10-25', audio_url: 'a.mp3' },
      { id: 'ohne-audio-jung', broadcast_date: '2026-10-22', audio_url: null },
      { id: 'vorgestern', broadcast_date: '2026-10-23', audio_url: 'b.mp3' },
      { id: 'grenze', broadcast_date: '2026-10-20', audio_url: null },
      { id: 'ohne-audio-alt', broadcast_date: '2026-10-01', audio_url: null },
      { id: 'alt', broadcast_date: '2026-09-30', audio_url: 'c.mp3' }
    ]
    expect(ordneEditionen(editionen, heute).map((e) => e.id)).toEqual([
      'ohne-audio-jung',
      'grenze',
      'heute',
      'vorgestern',
      'ohne-audio-alt',
      'alt'
    ])
  })
})
