import { describe, expect, it } from 'vitest'
import {
  apiTermin,
  AUFTRITTE_MAX,
  endZeitVon,
  lesetagAufOderVor,
  naechsterLesetag,
  planeDreiAufrufe,
  planeAnlassTermin,
  planeAuftritte,
  planeMitteilungTermin,
  pruefeTermin,
  publikationsTag,
  terminVorschlagAus,
  wichtigAus
} from './termin'

describe('naechsterLesetag', () => {
  // Das Briefing wird am Abend davor produziert — der Tag der Publikation ist
  // schon vorbei. Wer am Freitag publiziert, wird am Montag gelesen.
  it('nimmt den ersten Werktag NACH dem Tag', () => {
    expect(naechsterLesetag('2026-09-21')).toBe('2026-09-22') // Mo → Di
    expect(naechsterLesetag('2026-09-25')).toBe('2026-09-28') // Fr → Mo
    expect(naechsterLesetag('2026-09-26')).toBe('2026-09-28') // Sa → Mo
  })

  it('ueberspringt Basler Feiertage', () => {
    // 24.12.2026 ist ein Donnerstag; der 25. (Weihnachten) und 26.
    // (Stephanstag) sind frei, dann das Wochenende.
    expect(naechsterLesetag('2026-12-24')).toBe('2026-12-28')
  })
})

describe('publikationsTag', () => {
  it('rechnet den Zeitstempel in den Schweizer Kalendertag um', () => {
    // 23:30 UTC ist in Zuerich schon der naechste Tag (Sommerzeit).
    expect(publikationsTag('2026-09-21T23:30:00.000Z')).toBe('2026-09-22')
    expect(publikationsTag(null)).toBeNull()
    expect(publikationsTag('kein datum')).toBeNull()
  })
})

describe('pruefeTermin', () => {
  it('nimmt einen sauberen Termin an, sortiert und dedupliziert', () => {
    expect(
      pruefeTermin({
        ideal: '2026-10-17',
        ende: '2026-10-17',
        auftritte: ['2026-10-17', '2026-09-25', '2026-10-17']
      })
    ).toEqual({
      termin: {
        ideal: '2026-10-17',
        ende: '2026-10-17',
        auftritte: ['2026-09-25', '2026-10-17']
      },
      fehler: null
    })
  })

  it('setzt das Ende auf den idealen Tag, wenn keines kommt', () => {
    expect(pruefeTermin({ ideal: '2026-10-09' }).termin).toEqual({
      ideal: '2026-10-09',
      ende: '2026-10-09',
      auftritte: []
    })
  })

  it('kein idealer Tag heisst kein Termin — und kein Fehler', () => {
    expect(pruefeTermin(null)).toEqual({ termin: null, fehler: null })
    expect(pruefeTermin({ ideal: null })).toEqual({
      termin: null,
      fehler: null
    })
  })

  // Der Dorfkoenig protokolliert Unlesbares und laesst den Artikel laufen —
  // wir sagen es vorher, damit es gar nicht erst hinausgeht.
  it('benennt, was der Dorfkoenig nicht verstehen wuerde', () => {
    expect(pruefeTermin({ ideal: '17.10.2026' }).fehler).toMatch(/Kalendertag/)
    expect(pruefeTermin({ ideal: '2026-02-30' }).fehler).toMatch(/Kalendertag/)
    expect(
      pruefeTermin({ ideal: '2026-10-17', ende: '2026-10-16' }).fehler
    ).toMatch(/vor dem idealen Tag/)
    expect(
      pruefeTermin({ ideal: '2026-10-17', auftritte: ['2026-10-18'] }).fehler
    ).toMatch(/nach dem Ende/)
    expect(
      pruefeTermin({
        ideal: '2026-10-17',
        auftritte: [
          '2026-09-01',
          '2026-09-02',
          '2026-09-03',
          '2026-09-04',
          '2026-09-05',
          '2026-09-06'
        ]
      }).fehler
    ).toMatch(new RegExp(`Hoechstens ${AUFTRITTE_MAX}`))
  })
})

describe('planeAuftritte', () => {
  it('nicht wichtig: keine Liste — die Standardregel des Dorfkoenigs gilt', () => {
    expect(planeAuftritte('2026-10-17', '2026-10-17', false)).toEqual([])
  })

  it('wichtig: der Termin selbst; „sofort" rechnet erst die Auslieferung', () => {
    expect(planeAuftritte('2026-10-17', '2026-10-17', true)).toEqual([
      '2026-10-17'
    ])
  })

  // Eine Ausstellung, die Wochen laeuft, ist an einem Tag gesehen: ihr letzter
  // Tag ist eine letzte Gelegenheit. Ein Kurs bekommt das nie.
  it('gibt einem offenen, langen Anlass auch den letzten Tag', () => {
    expect(planeAuftritte('2026-10-01', '2026-11-15', true, 'offen')).toEqual([
      '2026-10-01',
      '2026-11-15'
    ])
    expect(
      planeAuftritte('2026-10-01', '2026-11-15', true, 'programm')
    ).toEqual(['2026-10-01'])
    expect(planeAuftritte('2026-10-01', '2026-10-04', true, 'offen')).toEqual([
      '2026-10-01'
    ])
  })
})

describe('planeAnlassTermin', () => {
  const anlass = {
    anker: 'einmalig',
    anker_am: '2026-10-17',
    frist_am: null,
    von: '2026-10-17',
    bis: null,
    termine: ['2026-10-17'],
    zugang: 'unbekannt' as const
  }

  it('nimmt den Anmeldeschluss vor dem Termin', () => {
    expect(
      planeAnlassTermin({ ...anlass, frist_am: '2026-10-09' }, false)
    ).toEqual({ ideal: '2026-10-09', ende: '2026-10-17', auftritte: [] })
  })

  it('nimmt den Tag des Ankers, sonst den ersten Termin', () => {
    expect(planeAnlassTermin(anlass, false)?.ideal).toBe('2026-10-17')
    expect(planeAnlassTermin({ ...anlass, anker_am: null }, false)?.ideal).toBe(
      '2026-10-17'
    )
  })

  it('ein Dauerangebot ohne Stichtag hat keinen Termin', () => {
    expect(
      planeAnlassTermin({ ...anlass, anker: 'dauerangebot' }, true)
    ).toBeNull()
    expect(planeAnlassTermin({ ...anlass, anker: 'routine' }, true)).toBeNull()
  })

  // Die Redaktion am 27.09.2026: ein Dauerangebot wird als Anlass an seinem
  // naechsten Termin geschrieben — und an diesem Tag bringt es der Dorfkoenig.
  it('ein Dauerangebot bekommt seinen naechsten Termin ab heute, einen Tag', () => {
    const palais = {
      anker: 'dauerangebot',
      anker_am: null,
      frist_am: null,
      von: '2026-09-22',
      bis: '2026-11-24',
      termine: ['2026-09-22', '2026-10-13', '2026-10-20'],
      zugang: 'offen' as const,
      heute: '2026-09-27'
    }
    expect(planeAnlassTermin(palais, false)).toEqual({
      ideal: '2026-10-13',
      ende: '2026-10-13',
      auftritte: []
    })
    expect(
      planeAnlassTermin({ ...palais, heute: '2026-10-21' }, false)
    ).toBeNull()
  })

  it('das Ende ist der letzte bekannte Tag, nie vor dem idealen', () => {
    expect(
      planeAnlassTermin(
        { ...anlass, bis: '2026-10-19', termine: ['2026-10-17', '2026-10-19'] },
        false
      )?.ende
    ).toBe('2026-10-19')
    // Anker „endet": der ideale Tag ist der letzte, das Ende darf nicht davor liegen.
    expect(
      planeAnlassTermin(
        {
          ...anlass,
          anker: 'endet',
          anker_am: '2026-10-19',
          bis: '2026-10-19'
        },
        false
      )
    ).toEqual({ ideal: '2026-10-19', ende: '2026-10-19', auftritte: [] })
  })
})

describe('planeMitteilungTermin', () => {
  const gefunden = ['2026-11-02', '2026-11-13']

  it('bindet den Vorschlag des Modells an die Daten im Wortlaut', () => {
    expect(
      planeMitteilungTermin(
        { ideal: '2026-11-02', ende: '2026-11-13' },
        gefunden,
        true
      )
    ).toEqual({
      termin: {
        ideal: '2026-11-02',
        ende: '2026-11-13',
        auftritte: ['2026-11-02']
      },
      warnung: null
    })
  })

  // Ein Tag, den der Code im Text nicht fand, ist erfunden oder verrechnet.
  it('verwirft einen Tag, der nicht im Wortlaut steht — und sagt es', () => {
    const ergebnis = planeMitteilungTermin(
      { ideal: '2026-11-03', ende: null },
      gefunden,
      false
    )
    expect(ergebnis.termin).toBeNull()
    expect(ergebnis.warnung).toMatch(/2026-11-03 steht nicht im Wortlaut/)
  })

  it('ohne Vorschlag kein Termin und keine Warnung', () => {
    expect(planeMitteilungTermin(null, gefunden, false)).toEqual({
      termin: null,
      warnung: null
    })
  })
})

describe('terminVorschlagAus / wichtigAus', () => {
  it('liest tolerant aus der Modellantwort', () => {
    expect(
      terminVorschlagAus({ ideal: ' 2026-11-02 ', ende: '2026-11-13' })
    ).toEqual({ ideal: '2026-11-02', ende: '2026-11-13' })
    expect(terminVorschlagAus({ ideal: '' })).toBeNull()
    expect(terminVorschlagAus(null)).toBeNull()
    expect(wichtigAus({ wichtig: true })).toBe(true)
    expect(wichtigAus({ wichtig: 'ja' })).toBe(false)
    expect(wichtigAus({})).toBe(false)
  })
})

describe('apiTermin — was der Dorfkoenig bekommt', () => {
  const termin = {
    ideal: '2026-10-17',
    ende: '2026-10-17',
    auftritte: ['2026-10-17']
  }

  // „Sofort" ist der erste Lesetag nach der PUBLIKATION — nicht nach dem Tag,
  // an dem der Lauf schrieb. Ein Artikel liegt oft Tage auf dem Tisch.
  it('stellt bei einem wichtigen Anlass den ersten Lesetag nach der Publikation voran', () => {
    expect(apiTermin(termin, true, '2026-09-24T10:00:00.000Z')).toEqual({
      ideal: '2026-10-17',
      ende: '2026-10-17',
      auftritte: ['2026-09-25', '2026-10-17']
    })
  })

  it('laesst ohne Auftritte die Liste weg — die Standardregel gilt', () => {
    expect(
      apiTermin({ ...termin, auftritte: [] }, false, '2026-09-24T10:00:00Z')
    ).toEqual({ ideal: '2026-10-17', ende: '2026-10-17' })
  })

  it('bringt nichts nach dem Ende und nichts doppelt', () => {
    // Publiziert am Tag vor dem Termin: „sofort" ist der Termin selbst.
    expect(apiTermin(termin, true, '2026-10-16T10:00:00Z')?.auftritte).toEqual([
      '2026-10-17'
    ])
    // Publiziert NACH dem Ende: der Sofort-Auftritt faellt weg; der geplante
    // Tag bleibt — dass er vorbei ist, zaehlt der Dorfkoenig selbst.
    expect(apiTermin(termin, true, '2026-10-20T10:00:00Z')).toEqual({
      ideal: '2026-10-17',
      ende: '2026-10-17',
      auftritte: ['2026-10-17']
    })
  })

  it('kappt auf fuenf und behaelt die fruehesten', () => {
    const viele = {
      ideal: '2026-10-01',
      ende: '2026-10-31',
      auftritte: [
        '2026-10-05',
        '2026-10-10',
        '2026-10-15',
        '2026-10-20',
        '2026-10-25'
      ]
    }
    expect(apiTermin(viele, true, '2026-09-24T10:00:00Z')?.auftritte).toEqual([
      '2026-09-25',
      '2026-10-05',
      '2026-10-10',
      '2026-10-15',
      '2026-10-20'
    ])
  })

  it('unpubliziert: kein „sofort", die Plan-Tage bleiben', () => {
    expect(apiTermin(termin, true, null)).toEqual({
      ideal: '2026-10-17',
      ende: '2026-10-17',
      auftritte: ['2026-10-17']
    })
    expect(apiTermin(null, true, '2026-09-24T10:00:00Z')).toBeNull()
  })
})

// Die Regel der Redaktion vom 30. September 2026 fuer eine Blutspende: zwei
// Wochen vor dem Termin, in der Woche des Termins (der Montag), am Tag des
// Termins — genau drei, kein „sofort". Jeder Tag ein Lesetag, gerechnet vom
// Code. Die Beispiele sind die Termine von blutspende.ch.
describe('planeDreiAufrufe — die drei Aufrufe einer Blutspende', () => {
  it('Aesch, Dienstag 26. Januar 2027, 17–20 Uhr: −14, Montag der Woche, der Tag', () => {
    expect(planeDreiAufrufe('2027-01-26', '17:00–20:00', '2026-12-01')).toEqual(
      {
        ideal: '2027-01-26',
        ende: '2027-01-26',
        auftritte: ['2027-01-12', '2027-01-25', '2027-01-26']
      }
    )
  })

  it('Muenchenstein, Dienstag 27. Oktober 2026 — was die Karte zeigen wird', () => {
    expect(
      planeDreiAufrufe('2026-10-27', '15:00–19:30', '2026-09-30')?.auftritte
    ).toEqual(['2026-10-13', '2026-10-26', '2026-10-27'])
  })

  // Ein Montagstermin: der Wochen-Aufruf faellt auf den Tag selbst und rueckt
  // auf den Lesetag davor, den Freitag.
  it('Pratteln, Montag 14. Dezember 2026: der Wochen-Aufruf rueckt auf den Freitag davor', () => {
    expect(
      planeDreiAufrufe('2026-12-14', '16:30–19:30', '2026-11-01')?.auftritte
    ).toEqual(['2026-11-30', '2026-12-11', '2026-12-14'])
  })

  // Ein Samstag ist kein Lesetag: „am Tag" wird der Freitag davor, und auch
  // die zwei Wochen davor landen auf einem Freitag.
  it('ein Samstag, 10–13 Uhr: alle drei Aufrufe auf Lesetagen', () => {
    expect(
      planeDreiAufrufe('2026-10-10', '10:00–13:00', '2026-09-01')?.auftritte
    ).toEqual(['2026-09-25', '2026-10-05', '2026-10-09'])
  })

  // Ostermontag 2027 ist der 29. Maerz. Der Montag der Woche ist ein Feiertag,
  // der naechste Lesetag waere der Termin selbst — also der Lesetag davor,
  // und der liegt vor Karfreitag: Donnerstag, 25. Maerz.
  it('ein Feiertag am Montag: der Wochen-Aufruf weicht auf den Lesetag davor aus', () => {
    expect(
      planeDreiAufrufe('2027-03-30', '17:00–20:00', '2027-03-01')?.auftritte
    ).toEqual(['2027-03-16', '2027-03-25', '2027-03-30'])
  })

  // Ohne Endzeit ist die sichere Seite der Lesetag davor: das Briefing ist um
  // zehn gelesen, und eine Spende am Vormittag waere dann vorbei.
  it('ohne Uhrzeit rueckt „am Tag" auf den Lesetag davor', () => {
    expect(
      planeDreiAufrufe('2027-01-26', null, '2026-12-01')?.auftritte
    ).toEqual(['2027-01-12', '2027-01-22', '2027-01-25'])
    expect(endZeitVon('17:00–20:00')).toBe('20:00')
    expect(endZeitVon('9:00')).toBe('09:00')
    expect(endZeitVon('abends')).toBeNull()
    expect(endZeitVon(null)).toBeNull()
  })

  it('was schon vorbei ist, faellt weg — eine spaet uebernommene Zeile bekommt weniger', () => {
    expect(
      planeDreiAufrufe('2027-01-26', '17:00–20:00', '2027-01-20')?.auftritte
    ).toEqual(['2027-01-25', '2027-01-26'])
    expect(
      planeDreiAufrufe('2027-01-26', '17:00–20:00', '2027-01-27')?.auftritte
    ).toEqual([])
    expect(planeDreiAufrufe('kein Datum', null, '2027-01-01')).toBeNull()
  })

  it('lesetagAufOderVor: ein Lesetag bleibt, ein Wochenende rueckt auf den Freitag', () => {
    expect(lesetagAufOderVor('2026-10-13')).toBe('2026-10-13')
    expect(lesetagAufOderVor('2026-10-10')).toBe('2026-10-09')
    expect(lesetagAufOderVor('2026-10-11')).toBe('2026-10-09')
  })

  // Genau drei: die Auslieferung stellt kein „sofort" voran, weil die Meldung
  // ohne Wichtig-Urteil gespeichert wird.
  it('ohne Wichtig-Urteil liefert die Auslieferung genau die drei Tage', () => {
    const termin = planeDreiAufrufe('2027-01-26', '17:00–20:00', '2026-12-01')
    expect(apiTermin(termin, null, '2026-12-28T10:00:00Z')).toEqual({
      ideal: '2027-01-26',
      ende: '2027-01-26',
      auftritte: ['2027-01-12', '2027-01-25', '2027-01-26']
    })
  })
})
