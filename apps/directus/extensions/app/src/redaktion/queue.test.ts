import { describe, expect, it } from 'vitest'
import {
  budgetErschoepft,
  darfWiederholen,
  fehlerText,
  istLeaseAbgelaufen,
  istVoruebergehend,
  laufStatusNachDurchlauf,
  leaseBis,
  LEASE_MS,
  MAX_VERSUCHE,
  offeneLaeufe,
  type Laufkandidat
} from './queue'

const JETZT = new Date('2026-08-05T10:00:00.000Z')

describe('leaseBis', () => {
  it('setzt die Sperre um die Lease-Dauer in die Zukunft', () => {
    expect(leaseBis(JETZT).getTime()).toBe(JETZT.getTime() + LEASE_MS)
  })
})

describe('istLeaseAbgelaufen', () => {
  it('gilt als abgelaufen, wenn nie eine gesetzt wurde', () => {
    expect(istLeaseAbgelaufen(null, JETZT)).toBe(true)
  })

  it('haelt eine laufende Sperre', () => {
    const bis = new Date(JETZT.getTime() + 60_000).toISOString()
    expect(istLeaseAbgelaufen(bis, JETZT)).toBe(false)
  })

  // The reason leases exist: a process killed mid-article must not leave the row
  // claimed forever. The next tick has to be able to take it back.
  it('gibt eine Zeile nach einem Absturz wieder frei', () => {
    const bis = new Date(JETZT.getTime() - 1000).toISOString()
    expect(istLeaseAbgelaufen(bis, JETZT)).toBe(true)
  })

  it('behandelt einen kaputten Zeitstempel als abgelaufen, nicht als ewig gesperrt', () => {
    expect(istLeaseAbgelaufen('kein datum', JETZT)).toBe(true)
  })

  it('nimmt auch ein Date entgegen', () => {
    expect(istLeaseAbgelaufen(new Date(JETZT.getTime() + 5000), JETZT)).toBe(
      false
    )
  })
})

describe('darfWiederholen', () => {
  it('laesst Wiederholungen bis zur Grenze zu', () => {
    expect(darfWiederholen(0)).toBe(true)
    expect(darfWiederholen(MAX_VERSUCHE - 1)).toBe(true)
  })

  // Without this a permanently broken row would be retried every two minutes
  // forever, and every attempt is a paid API call.
  it('gibt auf, statt endlos zu versuchen', () => {
    expect(darfWiederholen(MAX_VERSUCHE)).toBe(false)
    expect(darfWiederholen(MAX_VERSUCHE + 5)).toBe(false)
  })
})

describe('budgetErschoepft', () => {
  it('laesst arbeiten, solange Zeit ist', () => {
    expect(budgetErschoepft(0, 10_000, 60_000)).toBe(false)
  })

  // Stops a pass from running into the next scheduled tick.
  it('stoppt, wenn das Zeitbudget aufgebraucht ist', () => {
    expect(budgetErschoepft(0, 60_000, 60_000)).toBe(true)
    expect(budgetErschoepft(0, 90_000, 60_000)).toBe(true)
  })
})

describe('laufStatusNachDurchlauf', () => {
  it('bleibt beim Schreiben, solange etwas offen ist', () => {
    expect(laufStatusNachDurchlauf({ offen: 3, fehler: 0 })).toBe('schreibt')
    expect(laufStatusNachDurchlauf({ offen: 1, fehler: 2 })).toBe('schreibt')
  })

  it('ist bereit, wenn alles durch und nichts kaputt ist', () => {
    expect(laufStatusNachDurchlauf({ offen: 0, fehler: 0 })).toBe('bereit')
  })

  // An editor opening a run marked ready must not find half of it missing.
  it('meldet Fehler, statt einen unvollstaendigen Lauf als bereit auszugeben', () => {
    expect(laufStatusNachDurchlauf({ offen: 0, fehler: 1 })).toBe('fehler')
  })
})

describe('istVoruebergehend', () => {
  // The distinction that decides whether an attempt is spent. Getting it wrong
  // strands a perfectly good run in `fehler` because the API was busy for three
  // minutes, and asks a human to fix something that is not broken.
  it('erkennt eine ueberlastete API', () => {
    expect(istVoruebergehend({ status: 529 })).toBe(true)
    expect(
      istVoruebergehend(new Error('529 overloaded_error: Overloaded'))
    ).toBe(true)
  })

  it('erkennt Rate-Limits und Serverfehler', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(istVoruebergehend({ status })).toBe(true)
    }
  })

  it('erkennt Netzwerkabbrueche', () => {
    expect(istVoruebergehend(new Error('read ECONNRESET'))).toBe(true)
    expect(istVoruebergehend(new Error('connect ETIMEDOUT'))).toBe(true)
  })

  // These are the row's own problem and must eventually stop being retried —
  // every attempt costs a paid call.
  it('haelt einen inhaltlichen Fehler nicht faelschlich fuer voruebergehend', () => {
    expect(
      istVoruebergehend(new Error('Claude-Antwort enthaelt kein Feld "titel".'))
    ).toBe(false)
    expect(istVoruebergehend({ status: 400 })).toBe(false)
    expect(istVoruebergehend({ status: 401 })).toBe(false)
    expect(
      istVoruebergehend(new Error('Keine Zeilen fuer Periode 2025.'))
    ).toBe(false)
  })

  it('vertraegt alles, was kein Fehlerobjekt ist', () => {
    expect(istVoruebergehend(null)).toBe(false)
    expect(istVoruebergehend('kaputt')).toBe(false)
    expect(istVoruebergehend(undefined)).toBe(false)
  })
})

describe('fehlerText', () => {
  it('nennt Typ und Meldung', () => {
    expect(fehlerText(new Error('kaputt'))).toBe('Error: kaputt')
  })

  it('vertraegt auch etwas, das kein Error ist', () => {
    expect(fehlerText('nur ein String')).toBe('nur ein String')
    expect(fehlerText(null)).toBe('null')
  })

  it('macht Zeilenumbrueche platt und kuerzt', () => {
    const lang = new Error('a\n\nb'.padEnd(900, 'x'))
    const text = fehlerText(lang)

    expect(text).not.toContain('\n')
    expect(text.length).toBeLessThanOrEqual(500)
  })
})

describe('offeneLaeufe', () => {
  const kandidat = (ueber: Partial<Laufkandidat>): Laufkandidat => ({
    id: 'd',
    letzter_stand: 'a',
    lauf_stand: null,
    ...ueber
  })

  it('nimmt, was noch nie einen Lauf hatte', () => {
    expect(offeneLaeufe([kandidat({ id: 'neu' })], 3).map((k) => k.id)).toEqual(
      ['neu']
    )
  })

  // Der Kern des Staus: ein Datensatz, der nie einen Lauf eroeffnen kann,
  // belegte seinen Platz bei jedem Tick — alle 2 Minuten, dauerhaft.
  it('laesst abgearbeitete Datensaetze aus der Warteschlange', () => {
    const offen = offeneLaeufe(
      [
        kandidat({ id: 'erledigt', letzter_stand: 'a', lauf_stand: 'a' }),
        kandidat({ id: 'wartet', letzter_stand: 'b', lauf_stand: null })
      ],
      3
    )

    expect(offen.map((k) => k.id)).toEqual(['wartet'])
  })

  it('nimmt einen Datensatz wieder auf, sobald sich die Daten bewegt haben', () => {
    const offen = offeneLaeufe(
      [kandidat({ id: 'neue_zahlen', letzter_stand: 'b', lauf_stand: 'a' })],
      3
    )

    expect(offen).toHaveLength(1)
  })

  it('haelt sich an die Obergrenze', () => {
    const viele = Array.from({ length: 10 }, (_, i) =>
      kandidat({ id: `d${i}` })
    )
    expect(offeneLaeufe(viele, 3)).toHaveLength(3)
  })

  it('vertraegt eine Obergrenze von null', () => {
    expect(offeneLaeufe([kandidat({})], 0)).toEqual([])
  })
})

describe('offeneLaeufe — der ausdrueckliche Wunsch', () => {
  // Der Knopf „Meldungen erzeugen" ging ins Leere, weil `lauf_stand` den
  // Datensatz als erledigt fuehrte. Das ist Buchhaltung fuer die Nacht, keine
  // Antwort auf einen Klick.
  it('nimmt einen erledigten Datensatz, wenn ein Mensch ihn verlangt', () => {
    const erledigt = { id: 'd1', letzter_stand: 'a', lauf_stand: 'a' }

    expect(offeneLaeufe([erledigt], 1)).toHaveLength(0)
    expect(offeneLaeufe([erledigt], 1, true)).toHaveLength(1)
  })

  it('haelt sich auch dann an die Obergrenze', () => {
    const viele = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`,
      letzter_stand: 'a',
      lauf_stand: 'a'
    }))

    expect(offeneLaeufe(viele, 2, true)).toHaveLength(2)
  })
})
