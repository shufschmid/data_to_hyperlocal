import { describe, expect, it, vi } from 'vitest'
import {
  hatMaterial,
  kantonFakten,
  schreibeKantonMeldungen,
  type KantonRohzeile
} from './kantonmeldungen'

// `vi.mock` is hoisted — what its factory needs must be hoisted too.
const { completeJson, antworten, FormatFehler } = vi.hoisted(() => {
  class FormatFehler extends Error {
    constructor(readonly raw: string) {
      super('Claude did not return parseable JSON.')
      this.name = 'ClaudeFormatError'
    }
  }
  const antworten: Array<Record<string, unknown>> = []
  const standard = {
    titel: 'Münchenstein: Tempo 30 auf der Hauptstrasse',
    lead: 'Wie der Kanton Basel-Landschaft mitteilt, gilt ab 1. November 2026 Tempo 30.',
    text: 'Die Sicherheitsdirektion hat den Antrag geprüft und teilweise gutgeheissen.',
    termin: { ideal: '2026-11-01', ende: '2026-11-01' },
    wichtig: true
  }
  return {
    completeJson: vi.fn(
      async (_args: { prompt: string; system?: string }) =>
        antworten.shift() ?? standard
    ),
    antworten,
    FormatFehler
  }
})

vi.mock('../shared/claude', () => ({
  completeJson,
  ClaudeFormatError: FormatFehler
}))

const zeile = (ueber: Partial<KantonRohzeile> = {}): KantonRohzeile => ({
  id: 'k1',
  url: 'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30',
  quelle: 'medienmitteilung',
  behoerde: 'Sicherheitsdirektion',
  titel:
    'Tempo-30-Anträgen in Münchenstein und Birsfelden wird teilweise zugestimmt',
  teaser: null,
  publiziert_am: '2026-09-02',
  text: 'Die Sicherheitsdirektion hat die Anträge der Gemeinden geprüft. Auf der Hauptstrasse gilt ab 1. November 2026 Tempo 30.',
  text_abgeschnitten: false,
  gemeinden_genannt: ['Münchenstein', 'Bottmingen'],
  entscheid: 'offen',
  vorschlag_begruendung: 'Trifft die Hauptstrasse.',
  gemeinde: { id: 'g-m', name: 'Münchenstein' },
  ...ueber
})

function dienste(zeilen: KantonRohzeile[], beschrieben: string[] = []) {
  const erstellt: Record<string, unknown>[] = []
  const geaendert: Array<{ id: string; payload: Record<string, unknown> }> = []
  return {
    erstellt,
    geaendert,
    kontext: {
      mitteilungen: {
        readByQuery: async () => zeilen,
        createOne: async () => 'x',
        updateOne: async (id: string, payload: Record<string, unknown>) => {
          geaendert.push({ id, payload })
          return id
        }
      },
      meldungen: {
        readByQuery: async (q: Record<string, unknown>) => {
          const felder = (q['fields'] ?? []) as string[]
          if (felder.includes('kantonsmitteilung'))
            return beschrieben.map((id) => ({ kantonsmitteilung: id }))
          return []
        },
        createOne: async (payload: Record<string, unknown>) => {
          erstellt.push(payload)
          return `m-${erstellt.length}`
        },
        updateOne: async (id: string) => id
      },
      regeln: [],
      wichtigkeit: '',
      logger: { info: () => undefined, warn: () => undefined }
    }
  }
}

describe('kantonFakten', () => {
  it('nennt den Sprecher, die weiteren Gemeinden und die gefundenen Tage', () => {
    const f = kantonFakten(zeile(), '2026-09-29')
    expect(f.quelleName).toBe('Kanton Basel-Landschaft')
    expect(f.weitereGemeinden).toEqual(['Bottmingen'])
    expect(f.datenImText).toEqual(['2026-11-01'])
    expect(hatMaterial(f)).toBe(true)
    expect(hatMaterial(kantonFakten(zeile({ text: null })))).toBe(false)
  })
})

describe('schreibeKantonMeldungen — die Entwuerfe des Laufs', () => {
  it('schreibt je Vorschlag eine Meldung mit Quellenzeile, Termin und Datengrundlage und nimmt die Zeile', async () => {
    completeJson.mockClear()
    const { kontext, erstellt, geaendert } = dienste([zeile()])
    const r = await schreibeKantonMeldungen(kontext)
    expect(r).toEqual({ geschrieben: 1, ohneText: [], wartend: 0, fehler: [] })
    expect(completeJson).toHaveBeenCalledTimes(1)
    const m = erstellt[0]!
    expect(m['kantonsmitteilung']).toBe('k1')
    expect(m['gemeinde']).toBe('g-m')
    expect(m['status']).toBe('entwurf')
    expect(String(m['text'])).toMatch(
      /\n\nQuelle: Medienmitteilung des Kantons Basel-Landschaft \(Sicherheitsdirektion\) vom 2\. September 2026, https:\/\/www\.baselland\.ch\/politik-und-behorden/
    )
    expect(m['termin']).toEqual({
      ideal: '2026-11-01',
      ende: '2026-11-01',
      auftritte: ['2026-11-01']
    })
    expect(m['wichtig']).toBe(true)
    expect(m['zeit_warnungen']).toBeNull()
    expect(m['datengrundlage']).toMatchObject({
      quelle: 'kanton',
      quelle_name: 'Kanton Basel-Landschaft',
      quelle_art: 'medienmitteilung',
      url: zeile().url
    })
    expect(geaendert).toEqual([
      { id: 'k1', payload: { entscheid: 'uebernommen' } }
    ])
  })

  it('fasst bei fehlender Attribution einmal nach — mit dem Satz der Polizei', async () => {
    completeJson.mockClear()
    antworten.push(
      {
        titel: 'Brand',
        lead: 'In Allschwil brannte eine Einstellhalle.',
        text: 'Niemand wurde verletzt.',
        termin: null,
        wichtig: false
      },
      {
        titel: 'Brand',
        lead: 'Wie die Polizei Basel-Landschaft mitteilt, brannte in Allschwil eine Einstellhalle.',
        text: 'Niemand wurde verletzt.',
        termin: null,
        wichtig: false
      }
    )
    const { kontext, erstellt } = dienste([
      zeile({
        id: 'k2',
        quelle: 'polizeimeldung',
        behoerde: 'Polizei Basel-Landschaft',
        titel: 'Brand in Einstellhalle',
        teaser: 'In Allschwil brannte es.',
        text: 'In Allschwil brannte am 22. September 2026 eine Einstellhalle. Niemand wurde verletzt.',
        gemeinden_genannt: ['Allschwil'],
        gemeinde: { id: 'g-a', name: 'Allschwil' }
      })
    ])
    await schreibeKantonMeldungen(kontext)
    expect(completeJson).toHaveBeenCalledTimes(2)
    const zweiter = completeJson.mock.calls[1]?.[0]
    expect(zweiter?.prompt).toContain(
      '"wie die Polizei Basel-Landschaft mitteilt"'
    )
    expect(erstellt[0]?.['zeit_warnungen']).toBeNull()
    expect(String(erstellt[0]?.['text'])).toContain(
      'Quelle: Polizeimeldung der Polizei Basel-Landschaft vom 2. September 2026'
    )
  })

  it('warnt, wenn eine Polizeimeldung eine im Quelltext genannte Person wiederholt', async () => {
    completeJson.mockClear()
    antworten.push({
      titel: 'Vermisst',
      lead: 'Wie die Polizei Basel-Landschaft mitteilt, wird Max Muster vermisst.',
      text: 'Er wurde zuletzt in Reinach gesehen.',
      termin: null,
      wichtig: false
    })
    const { kontext, erstellt } = dienste([
      zeile({
        id: 'k3',
        quelle: 'polizeimeldung',
        behoerde: 'Polizei Basel-Landschaft',
        titel: 'Vermisst',
        teaser: null,
        text: 'Seit Montag wird Max Muster vermisst. Er wurde zuletzt in Reinach gesehen.',
        gemeinden_genannt: ['Reinach'],
        gemeinde: { id: 'g-r', name: 'Reinach' }
      })
    ])
    await schreibeKantonMeldungen(kontext)
    const warnungen = erstellt[0]?.['zeit_warnungen'] as string[]
    expect(warnungen.some((w) => /Max Muster|Person/i.test(w))).toBe(true)
  })

  it('laesst einen Termin fallen, den der Wortlaut nicht nennt, und sagt es', async () => {
    completeJson.mockClear()
    antworten.push({
      titel: 'T',
      lead: 'Wie der Kanton Basel-Landschaft mitteilt, gilt Tempo 30.',
      text: 'Text.',
      termin: { ideal: '2026-12-24', ende: '2026-12-24' },
      wichtig: false
    })
    const { kontext, erstellt } = dienste([zeile()])
    await schreibeKantonMeldungen(kontext)
    expect(erstellt[0]?.['termin']).toBeNull()
    expect((erstellt[0]?.['zeit_warnungen'] as string[]).join(' ')).toMatch(
      /Termin|Tag/
    )
  })

  it('deckelt, nennt Vorschlaege ohne Text und ueberspringt schon Beschriebenes', async () => {
    completeJson.mockClear()
    const { kontext, erstellt } = dienste(
      [
        zeile({ id: 'a' }),
        zeile({ id: 'b', text: null }),
        zeile({ id: 'c' }),
        zeile({ id: 'd' })
      ],
      ['d']
    )
    const r = await schreibeKantonMeldungen(kontext, 2)
    expect(r.geschrieben).toBe(1)
    expect(r.ohneText).toEqual([
      'Münchenstein: Tempo-30-Anträgen in Münchenstein und Birsfelden wird teilweise zugestimmt'
    ])
    expect(r.wartend).toBe(1)
    expect(erstellt).toHaveLength(1)
  })
})
