import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { MessageSender } from '../shared/claude'
import type { BuschtelefonFund } from '../types/schema'
import { TISCHE, tischVon, type BilanzZeile } from './bilanz'
import { lerneAusEntscheid } from './gedaechtnis'
import { ladeBuschtelefonSignale, type ItemsServiceLike } from './lernsignale'
import {
  EINSTELLBARE_TISCHE,
  istEinstellbarerTisch,
  tischFelder
} from './tischeinstellungen'
import {
  buschtelefonFundAlsHinweis,
  fundOhneWortlaut,
  fundTitel,
  reicheWeiter
} from './weiterreichen'
import { wissenFelderManuell } from './wissen'

// The Buschtelefon desk in the house's learning layer: the settings dial,
// the hand-up, the examples of a Sichtung, the rule learner and the tally.
// One thing runs through all of it: a find is a private person's post, and
// what is kept for good — a rule's `beleg` — never carries its wording.

type Query = Record<string, unknown>
const felderVon = (q: Query): string[] => (q['fields'] ?? []) as string[]
const filterVon = (q: Query): Record<string, unknown> =>
  (q['filter'] ?? {}) as Record<string, unknown>

/** A find as the desk holds it — more than the lead may read (`buschtelefonFundAlsHinweis` takes no material). */
type HinweisZeile = Parameters<typeof buschtelefonFundAlsHinweis>[0] &
  Parameters<typeof fundTitel>[0] &
  Pick<BuschtelefonFund, 'link' | 'kommentare'>

function fund(ueber: Partial<HinweisZeile> = {}): HinweisZeile {
  return {
    id: 'f-1',
    kanal: 'facebook',
    quelle_art: 'gruppe',
    quelle_name: 'Du bisch vo Aesch, wenn …',
    quelle_sichtbarkeit: 'oeffentlich',
    link: 'https://www.facebook.com/groups/1234567890/posts/987654321',
    veroeffentlicht_tag: '2026-11-08',
    text: 'Weiss jemand, warum die Hauptstrasse seit heute gesperrt ist?\nBin fast zu spät gekommen.',
    bilder: [],
    geteilt: null,
    kommentare: [],
    vorschlag_begruendung: 'Sperrung betrifft viele.',
    gemeinde: { id: 'g-aesch' },
    ...ueber
  }
}

function kommentar(
  ueber: Partial<NonNullable<BuschtelefonFund['kommentare']>[number]>
): NonNullable<BuschtelefonFund['kommentare']>[number] {
  return {
    kennung: 'k:1',
    kennung_art: 'plattform',
    stand: 'sichtbar',
    erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00',
    antwort_auf: null,
    autor_ref: 'B',
    autor_art: 'profil',
    autor_rolle: null,
    autor_name: null,
    autor_vorname: 'Marc',
    veroeffentlicht_am: '2026-11-08T20:01:00+01:00',
    datum_genauigkeit: 'minute',
    text: 'Wasserleitungsbruch, die IWB ist dran.',
    text_abgeschnitten: false,
    bilder: [],
    n_reaktionen: 4,
    ...ueber
  }
}

describe('tischeinstellungen — der dritte benotende Tisch', () => {
  it('kennt den Buschtelefon-Tisch', () => {
    expect(EINSTELLBARE_TISCHE).toContain('buschtelefon')
    expect(istEinstellbarerTisch('buschtelefon')).toBe(true)
    expect(istEinstellbarerTisch('smd')).toBe(false)
  })

  it('nimmt fuer ihn nur die Schwelle und laesst die Felder des Veranstaltungstischs fallen', () => {
    expect(
      tischFelder('buschtelefon', {
        schwelle: 2,
        vorlauf_stufe4: 45,
        dauerangebote_je_woche: 3
      })
    ).toEqual({ schwelle: 2 })
    // Selbst ein ungueltiger Vorlauf stoert nicht: er wird nie gelesen.
    expect(
      tischFelder('buschtelefon', { schwelle: '4', vorlauf_stufe3: 999 })
    ).toEqual({ schwelle: 4 })
  })

  it('verweigert einen Koerper ohne Schwelle und eine Schwelle ausserhalb 1–4', () => {
    expect(() => tischFelder('buschtelefon', { vorlauf_stufe4: 30 })).toThrow(
      /Keine Einstellung/
    )
    expect(() => tischFelder('buschtelefon', { schwelle: 5 })).toThrow(
      /Schwelle/
    )
  })

  it('laesst die zwei anderen Tische, wie sie waren', () => {
    expect(
      tischFelder('veranstaltung', { schwelle: 2, vorlauf_stufe4: 45 })
    ).toEqual({ schwelle: 2, vorlauf_stufe4: 45 })
  })
})

describe('fundTitel / fundOhneWortlaut', () => {
  it('nimmt die erste Zeile des Beitrags, auf 90 Zeichen gekuerzt', () => {
    expect(fundTitel(fund())).toBe(
      'Weiss jemand, warum die Hauptstrasse seit heute gesperrt ist?'
    )
    const lang = fundTitel(fund({ text: 'a'.repeat(200) }))
    expect(lang).toHaveLength(90)
    expect(lang.endsWith('…')).toBe(true)
  })

  it('faellt auf den gelesenen Bildtext, dann auf das Geteilte zurueck', () => {
    expect(
      fundTitel(
        fund({
          text: '',
          bilder: [
            {
              nr: 1,
              art: 'foto',
              text_status: 'kein_text',
              text: null,
              text_abgeschnitten: false,
              beschreibung: null
            },
            {
              nr: 2,
              art: 'flyer',
              text_status: 'gelesen',
              text: 'Räbeliechtli-Umzug\nFreitag, 13. November 2026',
              text_abgeschnitten: false,
              beschreibung: null
            }
          ]
        })
      )
    ).toBe('Räbeliechtli-Umzug')
    expect(
      fundTitel(
        fund({
          text: 'Achtung!',
          geteilt: null
        })
      )
    ).toBe('Achtung!')
  })

  it('nennt Quelle und Tag, wo kein Wortlaut mehr da ist', () => {
    const leer = fund({ text: null, bilder: [], geteilt: null })
    expect(fundTitel(leer)).toBe(
      'Beitrag aus Facebook-Gruppe «Du bisch vo Aesch, wenn …» vom 8. November 2026'
    )
    expect(fundTitel(leer)).toBe(fundOhneWortlaut(leer))
    expect(
      fundOhneWortlaut({
        kanal: 'instagram',
        quelle_art: 'konto',
        quelle_name: 'gemeinde_aesch',
        veroeffentlicht_tag: null
      })
    ).toBe('Beitrag aus Instagram-Konto «gemeinde_aesch»')
  })
})

describe('buschtelefonFundAlsHinweis', () => {
  // The lead lives in `recherchehinweise`, which keeps revisions: it carries
  // NO wording, the Chefredaktion reads the material live from the find.
  const MATERIAL = {
    text: 'Weiss jemand, warum die Hauptstrasse seit heute gesperrt ist?\nBin fast zu spät gekommen.',
    bilder: [
      {
        nr: 1,
        art: 'flyer' as const,
        text_status: 'gelesen' as const,
        text: 'Umleitung über die Bahnhofstrasse',
        text_abgeschnitten: false,
        beschreibung: null
      }
    ],
    kommentare: [
      kommentar({}),
      kommentar({
        kennung: 'k:2',
        autor_vorname: null,
        autor_ref: 'C',
        text: 'Danke!'
      })
    ]
  }

  it('nennt den Fund nur nach Quelle und Tag — kein Wortlaut, kein Bildtext, kein Vorname, kein Link', () => {
    const zeile = { ...fund(), ...MATERIAL }
    const felder = buschtelefonFundAlsHinweis(zeile, null)

    expect(felder).toEqual({
      gemeinde: 'g-aesch',
      titel:
        'Beitrag aus Facebook-Gruppe «Du bisch vo Aesch, wenn …» vom 8. November 2026',
      fundort:
        'Beitrag aus Facebook-Gruppe «Du bisch vo Aesch, wenn …» vom 8. November 2026 (Buschtelefon)',
      begruendung: 'Sperrung betrifft viele.',
      quelltext: null,
      status: 'offen',
      buschtelefon_fund: 'f-1'
    })
    const alsText = JSON.stringify(felder)
    for (const verboten of [
      'Hauptstrasse',
      'Bahnhofstrasse',
      'Wasserleitungsbruch',
      'Marc',
      'Danke',
      '/posts/987654321'
    ])
      expect(alsText).not.toContain(verboten)
  })

  it('sagt bei einer geschlossenen Gruppe «geschlossene Gruppe» — die Begruendung der Redaktorin geht der des Modells vor', () => {
    for (const sichtbarkeit of ['geschlossen', 'unbekannt'] as const) {
      const felder = buschtelefonFundAlsHinweis(
        fund({ quelle_sichtbarkeit: sichtbarkeit }),
        'Bitte nachfragen.'
      )
      expect(felder.fundort).toBe(
        'Beitrag aus Facebook-Gruppe «Du bisch vo Aesch, wenn …» vom 8. November 2026 — geschlossene Gruppe (Buschtelefon)'
      )
      expect(felder.quelltext).toBeNull()
      expect(felder.begruendung).toBe('Bitte nachfragen.')
    }
  })

  it('kommt ohne Gemeinde und ohne Tag aus', () => {
    const felder = buschtelefonFundAlsHinweis(
      fund({ gemeinde: null, veroeffentlicht_tag: null }),
      null
    )
    expect(felder.gemeinde).toBeNull()
    expect(felder.titel).toBe(
      'Beitrag aus Facebook-Gruppe «Du bisch vo Aesch, wenn …»'
    )
  })

  it('reicheWeiter stempelt den Entscheid samt Zeitpunkt in EINEM Schreibzugriff', async () => {
    const hinweise = { createOne: vi.fn().mockResolvedValue('h-1') }
    const ursprung = { updateOne: vi.fn().mockResolvedValue('f-1') }

    const id = await reicheWeiter(
      { hinweise, ursprung },
      {
        ursprungId: 'f-1',
        felder: buschtelefonFundAlsHinweis(fund(), null),
        ursprungFelder: { entschieden_am: '2026-11-11T12:30:00.000Z' }
      }
    )

    expect(id).toBe('h-1')
    expect(hinweise.createOne.mock.calls[0]?.[0]).toMatchObject({
      buschtelefon_fund: 'f-1',
      automatisch: false
    })
    expect(ursprung.updateOne).toHaveBeenCalledTimes(1)
    expect(ursprung.updateOne).toHaveBeenCalledWith('f-1', {
      entschieden_am: '2026-11-11T12:30:00.000Z',
      entscheid: 'weitergereicht'
    })
  })
})

describe('ladeBuschtelefonSignale', () => {
  function dienst(
    antwort: (query: Query) => unknown
  ): ItemsServiceLike & { aufrufe: Query[] } {
    const aufrufe: Query[] = []
    return {
      aufrufe,
      readByQuery: async (query: Query) => {
        aufrufe.push(query)
        return antwort(query)
      }
    }
  }

  it('liest je Gemeinde ueber die Quelle, fragt nie nach einer Titel-Spalte und benennt Geleertes ohne Wortlaut', async () => {
    const zeilen = dienst((q) => {
      const felder = felderVon(q)
      const filter = filterVon(q)
      if (felder.includes('ablehnungsgrund')) {
        return [
          {
            id: 'f1',
            text: 'Verkaufe Kinderwagen, fast neu',
            bilder: [],
            geteilt: null,
            kanal: 'facebook',
            quelle_art: 'gruppe',
            quelle_name: 'Aesch verkauft',
            veroeffentlicht_tag: '2026-11-02',
            entscheid: 'abgelehnt',
            ablehnungsgrund: 'personenbezug',
            ablehnungskommentar: 'Privater Verkauf'
          },
          {
            id: 'f2',
            // Retention has emptied this one.
            text: null,
            bilder: [],
            geteilt: null,
            kanal: 'facebook',
            quelle_art: 'gruppe',
            quelle_name: 'Du bisch vo Aesch, wenn …',
            veroeffentlicht_tag: '2026-10-01',
            entscheid: 'weitergereicht',
            ablehnungsgrund: null,
            ablehnungskommentar: null
          }
        ]
      }
      if (felder.length === 1 && felder[0] === 'id')
        return [{ id: 'f1' }, { id: 'f2' }]
      if (
        (filter['entscheid'] as { _eq?: string } | undefined)?._eq ===
        'verfallen'
      ) {
        // Lapsed rows are emptied at once — nothing left to name them by.
        return [
          {
            text: null,
            bilder: [],
            geteilt: null,
            kanal: 'facebook',
            quelle_art: 'gruppe',
            quelle_name: 'Aesch verkauft',
            veroeffentlicht_tag: '2026-10-20'
          }
        ]
      }
      return []
    })
    const hinweise = dienst((q) => {
      expect(filterVon(q)).toEqual({ buschtelefon_fund: { _in: ['f2'] } })
      return [
        {
          buschtelefon_fund: 'f2',
          status: 'brauchbar',
          kommentar: null,
          automatisch: false
        }
      ]
    })
    const meldungen = dienst(() => [])

    const signale = await ladeBuschtelefonSignale(
      { zeilen, hinweise, meldungen },
      'g-aesch',
      '2026-11-11'
    )

    // `buschtelefon_funde` has no `titel` column: asking for it would make
    // Directus refuse the whole query.
    for (const aufruf of zeilen.aufrufe)
      expect(felderVon(aufruf)).not.toContain('titel')
    expect(filterVon(zeilen.aufrufe[0] ?? {})).toEqual({
      gemeinde: { _eq: 'g-aesch' },
      entscheid: { _in: ['uebernommen', 'abgelehnt', 'weitergereicht'] }
    })

    expect(signale.entscheide).toHaveLength(2)
    expect(signale.entscheide[0]).toMatchObject({
      titel: 'Verkaufe Kinderwagen, fast neu',
      rubrikName: 'Aesch verkauft',
      entscheid: 'abgelehnt',
      grund: 'personenbezug',
      kommentar: 'Privater Verkauf'
    })
    expect(signale.entscheide[1]).toMatchObject({
      titel:
        'Beitrag aus Facebook-Gruppe «Du bisch vo Aesch, wenn …» vom 1. Oktober 2026',
      entscheid: 'weitergereicht'
    })
    expect(signale.entscheide[1]?.faehrte).not.toBeNull()
    expect(signale.rahmen.verfallene).toEqual([])
  })
})

describe('lerneAusEntscheid — Buschtelefon', () => {
  function nachricht(text: string): Anthropic.Message {
    return {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text, citations: null }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }
    } as unknown as Anthropic.Message
  }
  const STILL = { warn: vi.fn(), info: vi.fn() }
  const leer = { readByQuery: async () => [] }

  it('legt die Regel an, ohne den Wortlaut des Beitrags im Beleg zu behalten', async () => {
    const aufrufe: Query[] = []
    const zeilen = {
      readByQuery: async (q: Query) => {
        aufrufe.push(q)
        return felderVon(q).includes('text')
          ? [
              {
                id: 'f-1',
                kanal: 'facebook',
                quelle_art: 'gruppe',
                quelle_name: 'Aesch verkauft',
                veroeffentlicht_tag: '2026-11-02',
                text: 'Verkaufe Kinderwagen von Familie Muster, 079 123 45 67',
                vorschlag_begruendung: 'Angebot im Dorf.',
                gemeinde: { id: 'g-aesch', name: 'Aesch' }
              }
            ]
          : []
      }
    }
    const angelegt: Record<string, unknown>[] = []
    const wissen = {
      readByQuery: async () => [],
      createOne: async (p: Record<string, unknown>) => void angelegt.push(p),
      updateOne: async () => undefined
    }
    const send = vi.fn<MessageSender>().mockResolvedValue(
      nachricht(
        JSON.stringify({
          urteil: 'neu',
          regel_nr: null,
          regel: 'Private Verkaufsangebote nicht vorschlagen.',
          wirkung: 'hinweis'
        })
      )
    )

    await lerneAusEntscheid(
      { zeilen, hinweise: leer, wissen, logger: STILL, send },
      {
        tisch: 'buschtelefon',
        art: 'entscheid',
        zeileId: 'f-1',
        entscheid: 'abgelehnt',
        grund: 'nicht_relevant',
        kommentar: 'Kleinanzeigen wollen wir nie'
      }
    )

    for (const aufruf of aufrufe)
      expect(felderVon(aufruf)).not.toContain('titel')
    expect(angelegt).toHaveLength(1)
    expect(angelegt[0]).toMatchObject({
      bereich: 'buschtelefon',
      stufe: 'sichtung',
      herkunft: 'kommentar'
    })
    // The classifier may read the post; the rule store keeps only where and
    // when it stood, and the editor's own words.
    const prompt = JSON.stringify(send.mock.calls[0]?.[0]?.messages)
    expect(prompt).toContain('Verkaufe Kinderwagen')
    const beleg = String(angelegt[0]?.['beleg'])
    expect(beleg).toContain(
      'Beitrag aus Facebook-Gruppe «Aesch verkauft» vom 2. November 2026'
    )
    expect(beleg).toContain('Kleinanzeigen wollen wir nie')
    expect(beleg).not.toContain('Kinderwagen')
    expect(beleg).not.toContain('Muster')
    expect(beleg).not.toContain('079')
  })
})

describe('Bilanz und Regelerfassung', () => {
  it('zaehlt einen Artikel aus einem Fund auf dem Buschtelefon-Tisch', () => {
    const zeile: BilanzZeile = {
      status: 'entwurf',
      lauf: null,
      spiel: null,
      kandidat: null,
      amtsblattmeldung: null,
      gemeindemitteilung: null,
      veranstaltung: null,
      kantonsmitteilung: null,
      sendungskandidat: null,
      suedanflugquote: null,
      buschtelefon_fund: 'f-1',
      erscheint_am: null,
      date_created: null,
      freigegeben_am: null,
      publiziert_am: null,
      zurueckgezogen_am: null
    }
    expect(tischVon(zeile)).toBe('buschtelefon')
    expect(tischVon({ ...zeile, buschtelefon_fund: null })).toBe('ohne')
    expect(TISCHE.indexOf('buschtelefon')).toBe(TISCHE.indexOf('ohne') - 1)
  })

  it('nimmt eine von Hand erfasste Regel fuer den Tisch', () => {
    expect(
      wissenFelderManuell({
        bereich: 'buschtelefon',
        stufe: 'sichtung',
        regel: 'Verkaufsangebote nie vorschlagen.',
        wirkung: 'weiterreichen'
      })
    ).toMatchObject({
      bereich: 'buschtelefon',
      stufe: 'sichtung',
      wirkung: 'weiterreichen',
      herkunft: 'manuell'
    })
  })
})
