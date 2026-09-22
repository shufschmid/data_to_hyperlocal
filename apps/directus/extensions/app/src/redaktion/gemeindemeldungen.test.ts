import { describe, expect, it, vi } from 'vitest'
import {
  hatMaterial,
  mitteilungFakten,
  schreibeGemeindeMeldungen,
  type MitteilungRohzeile
} from './gemeindemeldungen'

// `vi.mock` wird gehoben — was seine Fabrik braucht, muss mit `vi.hoisted`
// vorher dastehen, sonst greift der Test auf eine noch leere Bindung zu.
const { completeJson, antwort, FormatFehler } = vi.hoisted(() => {
  class FormatFehler extends Error {
    constructor(readonly raw: string) {
      super('Claude did not return parseable JSON.')
      this.name = 'ClaudeFormatError'
    }
  }
  const antwort = {
    titel: 'Aesch saniert den Kindergarten',
    lead: 'Wie die Gemeinde Aesch mitteilt, wird saniert.',
    text: 'Der Gemeinderat hat die Sanierung beschlossen.',
    termin: { ideal: '2026-11-02', ende: '2026-11-13' },
    wichtig: true
  }
  return { completeJson: vi.fn(async () => antwort), antwort, FormatFehler }
})

vi.mock('../shared/claude', () => ({
  completeJson,
  ClaudeFormatError: FormatFehler
}))

const zeile = (
  ueber: Partial<MitteilungRohzeile> = {}
): MitteilungRohzeile => ({
  id: 'm1',
  url: 'https://www.aesch.bl.ch/_rte/information/1',
  url_kanonisch: null,
  quelle_seite: 'https://www.aesch.bl.ch/aktuellesinformationen',
  titel: 'Aus der Gemeinderatssitzung',
  teaser: 'Traktanden beschlossen.',
  publiziert_am: '2026-09-20',
  veranstaltung_am: null,
  kategorie: 'politik_info',
  text: 'Der Gemeinderat hat die Sanierung des Kindergartens beschlossen. Die Schulstrasse ist vom 2. November 2026 bis 13. November 2026 gesperrt.',
  text_abgeschnitten: false,
  anhaenge: null,
  entscheid: 'offen',
  vorschlag_begruendung: 'Beschluss mit Wirkung über die Verwaltung hinaus.',
  gemeinde: { id: 'g1', name: 'Aesch' },
  ...ueber
})

function dienste(zeilen: MitteilungRohzeile[], beschrieben: string[] = []) {
  const erstellt: Record<string, unknown>[] = []
  const geaendert: Array<{ id: string; payload: Record<string, unknown> }> = []
  return {
    erstellt,
    geaendert,
    mitteilungen: {
      readByQuery: vi.fn(async () => zeilen),
      createOne: vi.fn(async () => 'x'),
      updateOne: vi.fn(async (id: string, payload: Record<string, unknown>) => {
        geaendert.push({ id, payload })
        return id
      })
    },
    meldungen: {
      readByQuery: vi.fn(async () =>
        beschrieben.map((m) => ({ gemeindemitteilung: m }))
      ),
      createOne: vi.fn(async (payload: Record<string, unknown>) => {
        erstellt.push(payload)
        return `meldung-${erstellt.length}`
      }),
      updateOne: vi.fn(async (id: string) => id)
    },
    regeln: [],
    logger: { info: vi.fn(), warn: vi.fn() }
  }
}

describe('hatMaterial', () => {
  // Kein Artikel aus Titel und Anriss: er LIEST sich vollstaendig und ist es
  // nicht.
  it('verlangt Text oder einen gelesenen Anhang', () => {
    expect(hatMaterial(mitteilungFakten(zeile()))).toBe(true)
    expect(hatMaterial(mitteilungFakten(zeile({ text: '  ' })))).toBe(false)
    expect(
      hatMaterial(
        mitteilungFakten(
          zeile({
            text: null,
            anhaenge: [
              {
                bezeichnung: 'Protokoll',
                url: 'https://www.aesch.bl.ch/p.pdf',
                typ: 'pdf',
                gelesen: true,
                text: 'Der Rat beschliesst …'
              }
            ]
          })
        )
      )
    ).toBe(true)
    // Ein Anhang, den der Leser NICHT bekam, traegt keinen Artikel.
    expect(
      hatMaterial(
        mitteilungFakten(
          zeile({
            text: null,
            anhaenge: [
              {
                bezeichnung: 'Protokoll',
                url: 'https://www.aesch.bl.ch/p.pdf',
                typ: 'pdf',
                gelesen: false,
                grund: 'zu_gross'
              }
            ]
          })
        )
      )
    ).toBe(false)
  })
})

describe('schreibeGemeindeMeldungen', () => {
  it('schreibt je Vorschlag einen Artikel und uebernimmt die Zeile', async () => {
    const d = dienste([zeile()])
    const ergebnis = await schreibeGemeindeMeldungen(d, 10)

    expect(ergebnis.geschrieben).toBe(1)
    expect(d.erstellt[0]).toMatchObject({
      gemeindemitteilung: 'm1',
      gemeinde: 'g1',
      status: 'entwurf'
    })
    expect(d.geaendert).toEqual([
      { id: 'm1', payload: { entscheid: 'uebernommen' } }
    ])
    // Die Quellenzeile baut der Code an — der Artikel traegt sie.
    expect(String(d.erstellt[0]?.['text'])).toContain('Quelle:')
  })

  // Die Abmachung mit der Redaktion: nur die Vorschlaege. Was die Sichtung
  // liegen liess, bleibt ohne Artikel liegen — das ist der halbe Preis.
  it('fragt nur nach Vorschlaegen mit offenem Entscheid', async () => {
    const d = dienste([zeile()])
    await schreibeGemeindeMeldungen(d, 10)

    const rufe = d.mitteilungen.readByQuery.mock.calls as unknown as Array<
      [{ filter: Record<string, unknown> }]
    >
    const frage = rufe[0]?.[0]
    expect(frage?.filter).toEqual({
      vorschlag: { _eq: true },
      entscheid: { _eq: 'offen' }
    })
  })

  it('schreibt nicht zweimal zur selben Zeile', async () => {
    const d = dienste([zeile()], ['m1'])
    const ergebnis = await schreibeGemeindeMeldungen(d, 10)

    expect(ergebnis.geschrieben).toBe(0)
    expect(d.erstellt).toHaveLength(0)
  })

  it('haelt den Deckel ein und sagt, wie viele warten', async () => {
    const d = dienste([
      zeile({ id: 'a' }),
      zeile({ id: 'b' }),
      zeile({ id: 'c' })
    ])
    const ergebnis = await schreibeGemeindeMeldungen(d, 2)

    expect(ergebnis.geschrieben).toBe(2)
    expect(ergebnis.wartend).toBe(1)
  })

  it('nennt eine Zeile ohne Text, statt sie still zu uebergehen', async () => {
    const d = dienste([zeile({ text: null, anhaenge: null })])
    const ergebnis = await schreibeGemeindeMeldungen(d, 10)

    expect(ergebnis.geschrieben).toBe(0)
    expect(ergebnis.ohneText).toEqual(['Aesch: Aus der Gemeinderatssitzung'])
    expect(d.erstellt).toHaveLength(0)
  })

  it('ein gescheiterter Artikel kostet nur seine Zeile', async () => {
    const d = dienste([zeile({ id: 'a' }), zeile({ id: 'b' })])
    let erster = true
    d.meldungen.createOne = vi.fn(async (payload: Record<string, unknown>) => {
      if (erster) {
        erster = false
        throw new Error('Modell antwortete nicht')
      }
      d.erstellt.push(payload)
      return 'meldung-2'
    })

    const ergebnis = await schreibeGemeindeMeldungen(d, 10)
    expect(ergebnis.geschrieben).toBe(1)
    expect(ergebnis.fehler).toHaveLength(1)
    expect(ergebnis.fehler[0]).toContain('Modell antwortete nicht')
  })

  // Gemessen am ersten unbeaufsichtigten Lauf (21.09.2026): einer von zwanzig
  // Artikeln scheiterte an einer Antwort, die kein gueltiges JSON war. Solange
  // ein Mensch den Knopf drueckte, war das ein zweiter Klick; jetzt schreibt
  // der Lauf, und derselbe Ausrutscher kostet die Zeile sonst jeden Tag.
  it('fasst genau einmal nach, wenn die Antwort kein JSON ist', async () => {
    const d = dienste([zeile()])
    completeJson.mockReset()
    completeJson
      .mockRejectedValueOnce(new FormatFehler('{"titel": "abgeschnitten'))
      .mockResolvedValue(antwort)

    const ergebnis = await schreibeGemeindeMeldungen(d, 10)
    expect(ergebnis.geschrieben).toBe(1)
    expect(completeJson).toHaveBeenCalledTimes(2)
  })

  it('gibt auf, wenn auch der zweite Versuch kein JSON bringt', async () => {
    const d = dienste([zeile()])
    completeJson.mockReset()
    completeJson.mockRejectedValue(new FormatFehler('kaputt'))

    const ergebnis = await schreibeGemeindeMeldungen(d, 10)
    expect(ergebnis.geschrieben).toBe(0)
    expect(ergebnis.fehler).toHaveLength(1)
    expect(completeJson).toHaveBeenCalledTimes(2)
  })

  it('fasst bei einem anderen Fehler NICHT nach', async () => {
    const d = dienste([zeile()])
    completeJson.mockReset()
    completeJson.mockRejectedValue(new Error('Netzwerk weg'))

    const ergebnis = await schreibeGemeindeMeldungen(d, 10)
    expect(ergebnis.geschrieben).toBe(0)
    expect(completeJson).toHaveBeenCalledTimes(1)
  })

  // Seit dem 22. September 2026 traegt jede Meldung ihren Termin — und der
  // Vorschlag bleibt neben dem, was die Redaktion daraus macht.
  it('legt Termin und Wichtigkeit zweimal ab: zum Aendern und zum Erinnern', async () => {
    const d = dienste([zeile()])
    completeJson.mockReset()
    completeJson.mockResolvedValue(antwort)

    await schreibeGemeindeMeldungen(d, 10)
    const termin = {
      ideal: '2026-11-02',
      ende: '2026-11-13',
      auftritte: ['2026-11-02']
    }
    expect(d.erstellt[0]).toMatchObject({
      termin,
      termin_vorschlag: termin,
      wichtig: true,
      wichtig_vorschlag: true
    })
  })

  // Das Modell darf nur Tage nennen, die der Code im Wortlaut fand.
  it('verwirft einen Termin, dessen Tag nicht im Wortlaut steht — mit Warnung', async () => {
    const d = dienste([zeile()])
    completeJson.mockReset()
    completeJson.mockResolvedValue({
      ...antwort,
      termin: { ideal: '2026-11-03', ende: null }
    })

    await schreibeGemeindeMeldungen(d, 10)
    expect(d.erstellt[0]).toMatchObject({
      termin: null,
      termin_vorschlag: null
    })
    expect(String(d.erstellt[0]?.['zeit_warnungen'])).toContain(
      'Termin nicht uebernommen'
    )
  })
})
