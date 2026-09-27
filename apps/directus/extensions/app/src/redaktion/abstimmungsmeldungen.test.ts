import { describe, expect, it, vi } from 'vitest'
import type { Abstimmungszeile } from '../endpoints/redaktion/abstimmung'
import {
  schreibeTagesmeldungen,
  tagesFaktenAus,
  vorhandeneTagesmeldung
} from './abstimmungsmeldungen'
import {
  buildTagesPrompt,
  datengrundlageTag,
  mitTagesQuelle,
  stichfragenWarnungenTag,
  tagesQuelleUrl,
  weichtAb,
  zahlWarnungenTag
} from './abstimmungstag'

const { completeJson, FormatFehler } = vi.hoisted(() => {
  class FormatFehler extends Error {
    constructor(readonly raw: string) {
      super('Claude did not return parseable JSON.')
      this.name = 'ClaudeFormatError'
    }
  }
  const antwort = {
    titel: 'Binningen sagt Ja zur Mehrwertabgabe',
    lead: 'Nach dem amtlichen Ergebnis des Kantons hat Binningen am 27. September 2026 angenommen.',
    text: 'Anders als der Kanton hat Binningen die Initiative mit 58,3 Prozent Ja angenommen. Die Stimmbeteiligung lag bei 47,2 Prozent.'
  }
  return { completeJson: vi.fn(async () => antwort), FormatFehler }
})

vi.mock('../shared/claude', () => ({
  completeJson,
  ClaudeFormatError: FormatFehler
}))

const TAG = 'https://vework-public.bl.ch/app/publication/2026-09-27'

type Tageszeile = Abstimmungszeile & {
  bund?: { angenommen: boolean | null; beendet: boolean } | null
}

function kantonal(ueber: Partial<Tageszeile> = {}): Tageszeile {
  return {
    id: 'a-k3',
    vote_id: '20260927_K3',
    datum: '2026-09-27',
    titel: 'Initiative «Fairer Kompromiss bei der Mehrwertabgabe»',
    ebene: 'kanton',
    teile: [
      {
        art: 'vorlage',
        titel: 'Initiative «Fairer Kompromiss bei der Mehrwertabgabe»',
        url: `${TAG}/issues/k3a`,
        kanton: {
          ja: 30000,
          nein: 40000,
          prozentJa: 42.857,
          beteiligung: 44.4,
          stimmberechtigte: 190000,
          leer: 500,
          ungueltig: 300,
          antwort: 'abgelehnt',
          gemeinden: 86
        }
      }
    ],
    gemeindezahlen: [
      {
        bfs: '2765',
        gemeinde: 'Binningen',
        ausgezaehlt: true,
        ergebnisse: [
          {
            art: 'vorlage',
            antwort: 'angenommen',
            ja: 2100,
            nein: 1500,
            prozentJa: 58.3,
            beteiligung: 47.2,
            stimmberechtigte: 8000,
            leer: 40,
            ungueltig: 30
          }
        ]
      },
      {
        bfs: '2761',
        gemeinde: 'Aesch (BL)',
        ausgezaehlt: false,
        ergebnisse: []
      }
    ],
    gemeinden_total: 86,
    gemeinden_ausgezaehlt: 85,
    ausgezaehlt: false,
    stichfrage_gilt: false,
    stichfrage_grund: 'Zu dieser Frage gibt es keinen Gegenvorschlag.',
    vergleich: null,
    quelle_url: `${TAG}/issues/k3a`,
    ...ueber
  }
}

function eidgenoessisch(ueber: Partial<Tageszeile> = {}): Tageszeile {
  const basis = kantonal()
  return {
    ...basis,
    id: 'a-e1',
    vote_id: '20260927_E1',
    titel: 'Neutralitätsinitiative',
    ebene: 'bund',
    teile: [
      {
        ...basis.teile![0]!,
        titel: 'Neutralitätsinitiative',
        url: `${TAG}/issues/e1`,
        kanton: {
          ...basis.teile![0]!.kanton!,
          antwort: 'abgelehnt'
        }
      }
    ],
    gemeindezahlen: [
      {
        bfs: '2765',
        gemeinde: 'Binningen',
        ausgezaehlt: true,
        ergebnisse: [
          {
            art: 'vorlage',
            antwort: 'abgelehnt',
            ja: 1400,
            nein: 2300,
            prozentJa: 37.8,
            beteiligung: 47.3,
            stimmberechtigte: 8000,
            leer: 20,
            ungueltig: 10
          }
        ]
      }
    ],
    bund: { angenommen: true, beendet: true },
    quelle_url: `${TAG}/issues/e1`,
    ...ueber
  }
}

const binningen = { id: 'g-1', name: 'Binningen', bfs_nummer: 2765 }
const aesch = { id: 'g-2', name: 'Aesch (BL)', bfs_nummer: 2761 }

describe('weichtAb — code, nie das Modell', () => {
  it('vergleicht nur Ja/Nein', () => {
    expect(weichtAb('angenommen', 'abgelehnt')).toBe(true)
    expect(weichtAb('angenommen', 'angenommen')).toBe(false)
    expect(weichtAb('Initiative', 'abgelehnt')).toBeNull()
    expect(weichtAb(null, 'abgelehnt')).toBeNull()
  })
})

describe('tagesFaktenAus — ein Tag, eine Gemeinde', () => {
  const fakten = tagesFaktenAus([eidgenoessisch(), kantonal()], binningen)

  it('sagt je Vorlage, wo die Gemeinde anders entschied', () => {
    const [bund, kanton] = fakten.vorlagen
    expect(bund?.bundAntwort).toBe('angenommen')
    expect(bund?.andersAlsBund).toBe(true)
    expect(bund?.teile[0]?.andersAlsKanton).toBe(false)
    expect(kanton?.bundAntwort).toBeNull()
    expect(kanton?.teile[0]?.andersAlsKanton).toBe(true)
  })

  it('nimmt die Tagesseite als Quelle', () => {
    expect(fakten.quelleUrl).toBe(TAG)
    expect(tagesQuelleUrl(`${TAG}/issues/k3a`)).toBe(TAG)
    expect(mitTagesQuelle('Text.', fakten)).toMatch(
      /Quelle: Kanton Basel-Landschaft, amtliche Ergebnisse der Abstimmung vom 27\. September 2026, https:\/\/vework-public\.bl\.ch\/app\/publication\/2026-09-27$/
    )
  })

  it('verweigert eine Gemeinde, die noch auszaehlt', () => {
    expect(() => tagesFaktenAus([kantonal()], aesch)).toThrow()
  })

  it('kennt ohne finalen Bund keinen Vergleich mit der Schweiz', () => {
    const offen = tagesFaktenAus(
      [eidgenoessisch({ bund: { angenommen: null, beendet: false } })],
      binningen
    )
    expect(offen.vorlagen[0]?.bundAntwort).toBeNull()
    expect(offen.vorlagen[0]?.andersAlsBund).toBeNull()
  })

  it('legt die Vote-Ids in die Datengrundlage', () => {
    expect(datengrundlageTag(fakten)).toMatchObject({
      quelle: 'abstimmungstag',
      vote_ids: ['20260927_E1', '20260927_K3']
    })
  })
})

describe('buildTagesPrompt — die Zahlen von Kanton und Bund reisen nicht mit', () => {
  const fakten = tagesFaktenAus([eidgenoessisch(), kantonal()], binningen)
  const prompt = buildTagesPrompt(fakten)

  it('nennt die Abweichungen als Tatsache', () => {
    expect(prompt).toContain('ANDERS als die Schweiz')
    expect(prompt).toContain('ANDERS als der Kanton')
    expect(prompt).toContain('58,3 Prozent Ja')
  })

  it('enthaelt keine Zahl des Kantons', () => {
    expect(prompt).not.toContain('30000')
    expect(prompt).not.toContain('40000')
    expect(prompt).not.toContain('42,9')
  })

  it('meldet eine Kantonszahl im Text', () => {
    expect(
      zahlWarnungenTag('Der Kanton sagte mit 40000 Stimmen Nein.', fakten)
    ).toHaveLength(1)
    expect(
      zahlWarnungenTag('Binningen: 2100 Ja, 58,3 Prozent, 2026.', fakten)
    ).toEqual([])
  })

  it('meldet eine Stichfrage, die nichts entscheidet', () => {
    expect(
      stichfragenWarnungenTag('Bei der Stichfrage ...', fakten)
    ).toHaveLength(1)
    expect(stichfragenWarnungenTag('Ohne Stichwort.', fakten)).toEqual([])
  })
})

function dienste(
  zeilen: Tageszeile[],
  vorhanden: Array<{ abstimmung: string; gemeinde: string }> = []
) {
  const erstellt: Record<string, unknown>[] = []
  return {
    erstellt,
    kontext: {
      abstimmungen: {
        readByQuery: async () => zeilen,
        readOne: async () => ({}),
        createOne: async () => 'x',
        updateOne: async () => 'x'
      },
      gemeinden: {
        readByQuery: async () => [],
        readOne: async () => ({}),
        createOne: async () => 'x',
        updateOne: async () => 'x'
      },
      meldungen: {
        readByQuery: async (q: Record<string, unknown>) => {
          const filter = q['filter'] as {
            abstimmung: { _in: string[] }
            gemeinde: { _eq: string }
          }
          return vorhanden
            .filter(
              (v) =>
                filter.abstimmung._in.includes(v.abstimmung) &&
                v.gemeinde === filter.gemeinde._eq
            )
            .map(() => ({ id: 'm-alt' }))
        },
        readOne: async () => ({}),
        createOne: async (payload: Record<string, unknown>) => {
          erstellt.push(payload)
          return `m-${erstellt.length}`
        },
        updateOne: async () => 'x'
      },
      regeln: []
    }
  }
}

describe('schreibeTagesmeldungen — der Sonntagslauf', () => {
  it('schreibt je ausgezaehlte Gemeinde eine Meldung am ersten Tagesdatensatz', async () => {
    const { kontext, erstellt } = dienste([eidgenoessisch(), kantonal()])
    const ergebnis = await schreibeTagesmeldungen(kontext, '2026-09-27', [
      binningen,
      aesch
    ])

    expect(ergebnis.geschrieben).toEqual(['Binningen'])
    expect(ergebnis.offen).toEqual(['Aesch (BL)'])
    expect(erstellt).toHaveLength(1)
    expect(erstellt[0]).toMatchObject({
      abstimmung: 'a-e1',
      gemeinde: 'g-1',
      status: 'entwurf'
    })
    expect(String(erstellt[0]?.['text'])).toMatch(
      /Quelle: Kanton Basel-Landschaft/
    )
  })

  it('schreibt kein zweites Mal, egal an welcher Vorlage die erste haengt', async () => {
    const { kontext, erstellt } = dienste(
      [eidgenoessisch(), kantonal()],
      [{ abstimmung: 'a-k3', gemeinde: 'g-1' }]
    )
    const ergebnis = await schreibeTagesmeldungen(kontext, '2026-09-27', [
      binningen
    ])
    expect(ergebnis.vorhanden).toBe(1)
    expect(erstellt).toHaveLength(0)
    expect(
      await vorhandeneTagesmeldung(kontext.meldungen, [{ id: 'a-k3' }], 'g-1')
    ).toBe('m-alt')
  })

  it('nennt, was ueber den Deckel geht', async () => {
    const { kontext } = dienste([eidgenoessisch()])
    const ergebnis = await schreibeTagesmeldungen(
      kontext,
      '2026-09-27',
      [binningen, { id: 'g-3', name: 'Zweitbinningen', bfs_nummer: 2765 }],
      1
    )
    expect(ergebnis.geschrieben).toHaveLength(1)
    expect(ergebnis.wartend).toBe(1)
  })
})
