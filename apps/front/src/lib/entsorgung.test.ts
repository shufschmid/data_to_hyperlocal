import {
  erinnerungenNachMonat,
  faelligUnfreigegeben,
  fehlendeKalender,
  fristZeitText,
  kalenderStatusText,
  kurzesDatum,
  langesDatum,
  termineNachMonat,
  vorgeschlagenesJahr
} from './entsorgung'
import type {
  AlleMeldungFelder,
  EntsorgungskalenderFelder,
  EntsorgungsterminFelder,
  GemeindeFelder
} from '@/graphql/redaktion'

function termin(ueber: Partial<EntsorgungsterminFelder>): EntsorgungsterminFelder {
  return {
    id: 'id-1',
    kategorie: 'Papier, Karton',
    zone: null,
    datum: '2026-01-07',
    anmeldeschluss: null,
    anmeldeschluss_zeit: null,
    bereitstellung: null,
    anmeldung: null,
    warnung: null,
    geprueft: false,
    meldung: null,
    ...ueber
  }
}

function meldung(ueber: Partial<AlleMeldungFelder>): AlleMeldungFelder {
  return {
    id: 'm-1',
    titel: 'Titel',
    lead: 'Lead',
    text: 'Text',
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: null,
    fehler: null,
    publiziert_am: null,
    erscheint_am: '2026-06-09',
    date_created: null,
    gemeinde: { id: 'g-1', name: 'Binningen', bezirk: 'Arlesheim' },
    lauf: null,
    spiel: null,
    ...ueber
  }
}

function gemeinde(ueber: Partial<GemeindeFelder>): GemeindeFelder {
  return { id: 'g-1', name: 'Binningen', bezirk: 'Arlesheim', bfs_nummer: 2765, aktiv: true, ...ueber }
}

function kalender(ueber: Partial<EntsorgungskalenderFelder>): EntsorgungskalenderFelder {
  return {
    id: 'k-1',
    jahr: 2026,
    status: 'geprueft',
    merkblatt: null,
    gemeinde: { id: 'g-1', name: 'Binningen' },
    dokumente: [],
    ...ueber
  }
}

describe('langesDatum / kurzesDatum', () => {
  it('nennt Wochentag und volles Datum', () => {
    expect(langesDatum('2026-06-12')).toBe('Freitag, 12. Juni 2026')
  })

  it('verschiebt das Datum nicht ueber die Zeitzone', () => {
    // Mit `new Date('2026-01-07')` als lokalem Zeitpunkt waere hier in einer
    // Zeitzone oestlich von UTC der 6. Januar herausgekommen.
    expect(langesDatum('2026-01-07')).toBe('Mittwoch, 7. Januar 2026')
    expect(kurzesDatum('2026-01-07')).toBe('Mi 07.01.')
  })

  it('kommt mit einem Zeitstempel und mit null zurecht', () => {
    expect(langesDatum('2026-06-12T00:00:00')).toBe('Freitag, 12. Juni 2026')
    expect(langesDatum(null)).toBe('—')
  })
})

describe('termineNachMonat', () => {
  it('gruppiert chronologisch nach Monat', () => {
    const gruppen = termineNachMonat([
      termin({ id: 'b', datum: '2026-03-04' }),
      termin({ id: 'a', datum: '2026-01-07' }),
      termin({ id: 'c', datum: '2026-01-23' })
    ])

    expect(gruppen.map((g) => g.monat)).toEqual(['Januar 2026', 'März 2026'])
    expect(gruppen[0]?.eintraege).toHaveLength(2)
  })

  it('gruppiert ueber den Jahreswechsel getrennt', () => {
    // Der Kalender druckt den Januar des Folgejahres mit.
    const gruppen = termineNachMonat([termin({ datum: '2026-12-14' }), termin({ datum: '2027-01-06' })])

    expect(gruppen.map((g) => g.monat)).toEqual(['Dezember 2026', 'Januar 2027'])
  })
})

describe('erinnerungenNachMonat', () => {
  it('nimmt nur Entsorgungserinnerungen', () => {
    const gruppen = erinnerungenNachMonat([
      meldung({ id: 'a', erscheint_am: '2026-06-09' }),
      meldung({ id: 'b', erscheint_am: null, lauf: { id: 'l-1' } })
    ])

    expect(gruppen).toHaveLength(1)
    expect(gruppen[0]?.eintraege).toHaveLength(1)
  })
})

describe('fehlendeKalender', () => {
  const heuteImJanuar = new Date('2027-01-15T12:00:00Z')

  it('nennt aktive Gemeinden ohne Kalender fuers laufende Jahr', () => {
    const fehlend = fehlendeKalender(
      [gemeinde({ id: 'g-1' }), gemeinde({ id: 'g-2', name: 'Aesch' })],
      [kalender({ jahr: 2027, gemeinde: { id: 'g-1', name: 'Binningen' } })],
      heuteImJanuar
    )

    expect(fehlend.map((g) => g.name)).toEqual(['Aesch'])
  })

  it('zaehlt einen Kalender des Vorjahres nicht', () => {
    const fehlend = fehlendeKalender([gemeinde({})], [kalender({ jahr: 2026 })], heuteImJanuar)

    expect(fehlend).toHaveLength(1)
  })

  it('uebergeht inaktive Gemeinden', () => {
    const fehlend = fehlendeKalender([gemeinde({ aktiv: false })], [], heuteImJanuar)
    expect(fehlend).toHaveLength(0)
  })

  it('schweigt ausserhalb des Januars', () => {
    // Im Juni existiert der Kalender des Folgejahres schlicht noch nicht — ein
    // Banner, das das ganze Jahr mahnt, wird bis Januar ignoriert.
    const fehlend = fehlendeKalender([gemeinde({})], [], new Date('2027-06-15T12:00:00Z'))

    expect(fehlend).toHaveLength(0)
  })
})

describe('faelligUnfreigegeben', () => {
  const heute = new Date('2026-06-08T12:00:00Z')

  it('nennt Entwuerfe, deren Erscheinungstag naht', () => {
    // Sonst erschiene die Erinnerung nie — der Tageslauf nimmt nur Freigegebene.
    const faellig = faelligUnfreigegeben(
      [meldung({ id: 'a', erscheint_am: '2026-06-09', status: 'entwurf' })],
      heute
    )

    expect(faellig.map((m) => m.id)).toEqual(['a'])
  })

  it('uebergeht bereits freigegebene', () => {
    const faellig = faelligUnfreigegeben(
      [meldung({ erscheint_am: '2026-06-09', status: 'freigegeben' })],
      heute
    )

    expect(faellig).toHaveLength(0)
  })

  it('uebergeht Entwuerfe, die noch weit weg sind', () => {
    const faellig = faelligUnfreigegeben([meldung({ erscheint_am: '2026-09-01', status: 'entwurf' })], heute)

    expect(faellig).toHaveLength(0)
  })

  it('uebergeht Entwuerfe, deren Tag vorbei ist', () => {
    const faellig = faelligUnfreigegeben([meldung({ erscheint_am: '2026-05-01', status: 'entwurf' })], heute)

    expect(faellig).toHaveLength(0)
  })
})

describe('vorgeschlagenesJahr', () => {
  it('schlaegt im Herbst das kommende Jahr vor', () => {
    // Ab Oktober liegt der Kalender des Folgejahres im Briefkasten.
    expect(vorgeschlagenesJahr(new Date('2026-10-05T12:00:00Z'))).toBe(2027)
    expect(vorgeschlagenesJahr(new Date('2026-03-05T12:00:00Z'))).toBe(2026)
  })
})

describe('fristZeitText', () => {
  it('schreibt eine Uhrzeit mit Punkt und "Uhr"', () => {
    expect(fristZeitText('11:30')).toBe('11.30 Uhr')
  })

  it('laesst eine Tageszeit als Wort stehen', () => {
    // "Vormittag" ist die Angabe des gedruckten Kalenders — keine erfundene
    // Uhrzeit daraus machen.
    expect(fristZeitText('Vormittag')).toBe('Vormittag')
  })
})

describe('kalenderStatusText', () => {
  it('uebersetzt die Status ins Deutsche', () => {
    expect(kalenderStatusText('extrahiert')).toBe('Ausgelesen')
    expect(kalenderStatusText('geprueft')).toBe('Geprüft')
    expect(kalenderStatusText('liest')).toBe('Wird ausgelesen')
  })
})
