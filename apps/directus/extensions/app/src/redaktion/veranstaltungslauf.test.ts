import { describe, expect, it, vi } from 'vitest'
import { heuteAus } from '../shared/gemeindeseite'
import type { Anlass, GeleseneAnlass } from '../shared/veranstaltung'
import type { ListenEintrag } from '../shared/gemeindeseite/liste'
import {
  brauchtDetail,
  dauerangeboteHeute,
  detailPayload,
  kuerzeFelder,
  ladeNewsKontext,
  ortAusserhalb,
  raeumeAnlaesseAuf,
  schreibeAnlaesse,
  sichteAnlaesse,
  sichtungsKandidat,
  verpassteAnmeldung,
  type AnlaesseDienst,
  type BekannteZeile,
  type GeschriebenerAnlass
} from './veranstaltungslauf'

const HEUTE = '2026-09-18'
const HEUTE_OBJ = heuteAus(HEUTE)
const logger = { info: vi.fn(), warn: vi.fn() }

const eintrag = (titel: string, am: string): ListenEintrag => ({
  url: `https://www.example.ch/anlass/${encodeURIComponent(titel)}/${am}`,
  titel,
  teaser: null,
  datum: null,
  datumQuelle: null,
  kategorie: null,
  direktPdf: false,
  veranstaltungAm: am,
  veranstaltungBis: null,
  zeit: null,
  lokalitaet: null,
  ort: null,
  veranstalter: null,
  serie: null,
  serieSeit: null,
  abgesagt: false
})

const anlass = (ueber: Partial<Anlass> & { titel: string }): Anlass => {
  const termine = ueber.termine ?? ['2026-09-25']
  return {
    schluessel: ueber.titel.toLowerCase(),
    termine,
    von: termine[0] ?? '2026-09-25',
    bis: termine.length > 1 ? (termine[termine.length - 1] ?? null) : null,
    spanne: false,
    zeit: null,
    lokalitaet: null,
    ort: null,
    veranstalter: null,
    kategorie: null,
    teaser: null,
    url: `https://www.example.ch/anlass/${ueber.titel}`,
    eintraege: termine.map((t) => eintrag(ueber.titel, t)),
    abgesagt: false,
    serieSeit: null,
    ...ueber
  }
}

const bekannt = (
  ueber: Partial<BekannteZeile> & { id: string; schluessel: string }
): BekannteZeile => ({
  titel: ueber.schluessel,
  anker: 'einmalig',
  anker_am: null,
  entscheid: 'offen',
  vorschlag: null,
  gelesen_am: null,
  zuletzt_vorgelegt_am: null,
  zuletzt_gemeldet_am: null,
  dauerangebot: null,
  zugang: 'unbekannt',
  frist_am: null,
  beschreibung: null,
  url: 'https://www.example.ch/x',
  hinweise: null,
  ...ueber
})

function dienst(zeilen: unknown[] = []): AnlaesseDienst & {
  erstellt: Record<string, unknown>[]
  geaendert: Array<{ id: string; payload: Record<string, unknown> }>
} {
  const erstellt: Record<string, unknown>[] = []
  const geaendert: Array<{ id: string; payload: Record<string, unknown> }> = []
  return {
    erstellt,
    geaendert,
    readByQuery: vi.fn(async () => zeilen),
    createOne: vi.fn(async (payload: Record<string, unknown>) => {
      erstellt.push(payload)
      return `neu-${erstellt.length}`
    }),
    updateOne: vi.fn(async (id: string, payload: Record<string, unknown>) => {
      geaendert.push({ id, payload })
      return id
    }),
    updateMany: vi.fn(async () => []),
    deleteMany: vi.fn(async () => [])
  }
}

const QUELLE = {
  id: 'q1',
  gemeinde: { id: 'g1', name: 'Pratteln' },
  plattform: 'iweb_termine'
}

describe('ortAusserhalb', () => {
  it('erkennt einen fremden Ort und ignoriert Kantonskuerzel', () => {
    expect(ortAusserhalb('Bottmingen', 'Binningen')).toBe(true)
    expect(ortAusserhalb('Pratteln', 'Pratteln')).toBe(false)
    expect(ortAusserhalb('Aesch BL', 'Aesch')).toBe(false)
    expect(ortAusserhalb('4147 Aesch', 'Aesch')).toBe(false)
    expect(ortAusserhalb(null, 'Aesch')).toBe(false)
  })
})

describe('schreibeAnlaesse', () => {
  it('legt Unbekanntes an und markiert die Serie als neu erkannt — nicht auf dem Erstlauf', async () => {
    const d = dienst()
    const { geschrieben } = await schreibeAnlaesse(
      d,
      QUELLE,
      [
        anlass({
          titel: 'Markt des Alterns',
          veranstalter: 'Gemeinde Pratteln'
        })
      ],
      new Map(),
      HEUTE,
      HEUTE_OBJ,
      false,
      logger
    )
    expect(geschrieben[0]).toMatchObject({ id: 'neu-1', vorher: null })
    expect(d.erstellt[0]).toMatchObject({
      quelle: 'q1',
      gemeinde: 'g1',
      schluessel: 'markt des alterns',
      anker: 'einmalig',
      anker_am: '2026-09-25',
      rhythmus: 'einmalig',
      zuletzt_gesehen_am: HEUTE,
      entscheid: 'offen',
      hinweise: ['Serie neu erkannt.']
    })
    const e = dienst()
    await schreibeAnlaesse(
      e,
      QUELLE,
      [anlass({ titel: 'Markt des Alterns' })],
      new Map(),
      HEUTE,
      HEUTE_OBJ,
      true,
      logger
    )
    expect(e.erstellt[0]?.hinweise).toEqual([])
  })

  it('aktualisiert eine bekannte Zeile, behaelt ihren Entscheid und liest den Rhythmus aus dem gespeicherten Text', async () => {
    const d = dienst()
    const vorher = bekannt({
      id: 'z1',
      schluessel: 'freitags treff',
      anker: 'routine',
      entscheid: 'abgelehnt',
      vorschlag: false,
      beschreibung: 'Jeden Freitag von 9 bis 11 Uhr.'
    })
    const { geschrieben } = await schreibeAnlaesse(
      d,
      QUELLE,
      [anlass({ titel: 'Freitags Treff', termine: ['2026-09-25'] })],
      new Map([['freitags treff', vorher]]),
      HEUTE,
      HEUTE_OBJ,
      false,
      logger
    )
    expect(geschrieben[0]?.befund.anker).toBe('routine')
    expect(d.erstellt).toHaveLength(0)
    expect(d.geaendert[0]?.id).toBe('z1')
    expect(d.geaendert[0]?.payload).not.toHaveProperty('entscheid')
    expect(d.geaendert[0]?.payload).toMatchObject({
      rhythmus: 'woechentlich',
      anker: 'routine'
    })
  })

  it('oeffnet eine entschiedene Zeile wieder, wenn ein Ausfall dazukommt; ein neuer Anker loescht das alte Urteil', async () => {
    const d = dienst()
    const vorher = bekannt({
      id: 'z1',
      schluessel: 'gemeindeversammlung',
      anker: 'gremium',
      entscheid: 'abgelehnt',
      vorschlag: false
    })
    await schreibeAnlaesse(
      d,
      QUELLE,
      [
        anlass({
          titel: 'Gemeindeversammlung',
          abgesagt: true,
          termine: ['2026-10-15']
        })
      ],
      new Map([['gemeindeversammlung', vorher]]),
      HEUTE,
      HEUTE_OBJ,
      false,
      logger
    )
    expect(d.geaendert[0]?.payload).toMatchObject({
      anker: 'ausfall',
      entscheid: 'offen',
      vorschlag: null
    })
    expect(d.geaendert[0]?.payload.hinweise).toContain(
      'Neuer Anker nach Entscheid: ausfall.'
    )

    const e = dienst()
    const offen = bekannt({
      id: 'z2',
      schluessel: 'x',
      anker: 'routine',
      vorschlag: false
    })
    await schreibeAnlaesse(
      e,
      QUELLE,
      [anlass({ titel: 'X', termine: ['2026-09-25'] })],
      new Map([['x', offen]]),
      HEUTE,
      HEUTE_OBJ,
      false,
      logger
    )
    expect(e.geaendert[0]?.payload).toMatchObject({
      anker: 'einmalig',
      vorschlag: null,
      vorschlag_begruendung: null
    })
  })

  it('ein Fehler beim Speichern kostet nur diese Zeile', async () => {
    const d = dienst()
    d.createOne = vi.fn(async () => {
      throw new Error('kaputt')
    })
    const { geschrieben } = await schreibeAnlaesse(
      d,
      QUELLE,
      [anlass({ titel: 'A' }), anlass({ titel: 'B' })],
      new Map(),
      HEUTE,
      HEUTE_OBJ,
      false,
      logger
    )
    expect(geschrieben).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalled()
  })

  // Abfuhren stehen laengst auf dem Entsorgungstisch, aus dem Abfuhrkalender.
  // Der Lauf zaehlt sie, damit ihr Fehlen nie still ist, und speichert sie
  // nicht.
  it('zaehlt eine Abfuhr und legt keine Zeile dafuer an', async () => {
    const d = dienst()
    const { geschrieben, abfuhren } = await schreibeAnlaesse(
      d,
      QUELLE,
      [
        anlass({ titel: 'Grünabfuhr', termine: ['2026-09-25'] }),
        anlass({ titel: 'Markt des Alterns', termine: ['2026-09-25'] })
      ],
      new Map(),
      HEUTE,
      HEUTE_OBJ,
      false,
      logger
    )
    expect(abfuhren).toBe(1)
    expect(geschrieben).toHaveLength(1)
    expect(geschrieben[0]?.anlass.titel).toBe('Markt des Alterns')
    expect(d.erstellt).toHaveLength(1)
  })

  it('entfernt eine Zeile, die zur Abfuhr geworden ist — aber nur eine offene', async () => {
    const d = dienst()
    const vorher = bekannt({
      id: 'z9',
      schluessel: 'grünabfuhr',
      anker: 'einmalig',
      entscheid: 'offen'
    })
    await schreibeAnlaesse(
      d,
      QUELLE,
      [anlass({ titel: 'Grünabfuhr', termine: ['2026-09-25'] })],
      new Map([['grünabfuhr', vorher]]),
      HEUTE,
      HEUTE_OBJ,
      false,
      logger
    )
    expect(d.deleteMany).toHaveBeenCalledWith(['z9'])
  })
})

describe('brauchtDetail und sichtungsKandidat', () => {
  const g = (
    ueber: Partial<GeschriebenerAnlass['befund']>,
    vorher: BekannteZeile | null = null
  ): GeschriebenerAnlass => ({
    id: 'x',
    anlass: anlass({ titel: 'X' }),
    vorher,
    befund: {
      anker: 'einmalig',
      ankerAm: '2026-09-25',
      grund: '',
      hinweise: [],
      rhythmus: {
        rhythmus: 'einmalig',
        ausText: false,
        ganzjaehrig: false,
        abweichung: null,
        fehlend: null
      },
      zugang: 'unbekannt',
      fristAm: null,
      ...ueber
    }
  })

  it('liest, was im Fenster verankert ist oder von der Sorte ist, die sofort zaehlt — einmal je Anlass', () => {
    expect(brauchtDetail(g({}), HEUTE, 10)).toBe(true)
    expect(brauchtDetail(g({ ankerAm: '2026-10-20' }), HEUTE, 10)).toBe(false)
    expect(
      brauchtDetail(g({ anker: 'gremium', ankerAm: '2026-10-20' }), HEUTE, 10)
    ).toBe(true)
    expect(
      brauchtDetail(g({ anker: 'routine', ankerAm: null }), HEUTE, 10)
    ).toBe(false)
    expect(brauchtDetail(g({ anker: 'abfuhr' }), HEUTE, 10)).toBe(false)
    expect(
      brauchtDetail(
        g(
          {},
          bekannt({
            id: 'x',
            schluessel: 'x',
            gelesen_am: '2026-09-10T00:00:00Z'
          })
        ),
        HEUTE,
        10
      )
    ).toBe(false)
  })

  it('ein Sichtungskandidat ist offen, unbeurteilt, verankert und im Fenster', () => {
    expect(
      sichtungsKandidat(
        {
          anker: 'einmalig',
          anker_am: '2026-09-25',
          vorschlag: null,
          entscheid: 'offen'
        },
        HEUTE,
        10
      )
    ).toBe(true)
    expect(
      sichtungsKandidat(
        {
          anker: 'einmalig',
          anker_am: '2026-09-25',
          vorschlag: false,
          entscheid: 'offen'
        },
        HEUTE,
        10
      )
    ).toBe(false)
    expect(
      sichtungsKandidat(
        {
          anker: 'einmalig',
          anker_am: '2026-10-25',
          vorschlag: null,
          entscheid: 'offen'
        },
        HEUTE,
        10
      )
    ).toBe(false)
    expect(
      sichtungsKandidat(
        {
          anker: 'routine',
          anker_am: null,
          vorschlag: null,
          entscheid: 'offen'
        },
        HEUTE,
        10
      )
    ).toBe(false)
    expect(
      sichtungsKandidat(
        {
          anker: 'einmalig',
          anker_am: '2026-09-25',
          vorschlag: null,
          entscheid: 'abgelehnt'
        },
        HEUTE,
        10
      )
    ).toBe(false)
  })
})

describe('detailPayload', () => {
  it('uebernimmt die Felder der Detailseite, mischt die Termine und rechnet den Anker neu', () => {
    const g: GeschriebenerAnlass = {
      id: 'x',
      anlass: anlass({
        titel: 'Mittagstisch',
        termine: ['2026-09-24'],
        teaser: 'Senioren'
      }),
      vorher: null,
      befund: {
        anker: 'einmalig',
        ankerAm: '2026-09-24',
        grund: '',
        hinweise: [],
        rhythmus: {
          rhythmus: 'einmalig',
          ausText: false,
          ganzjaehrig: false,
          abweichung: null,
          fehlend: null
        },
        zugang: 'unbekannt',
        fristAm: null
      }
    }
    const gelesen: GeleseneAnlass = {
      detail: {
        titel: 'Mittagstisch',
        zeit: '12:00–14:00',
        lokalitaet: 'Gemeindestube',
        adresse: 'Therwilerstrasse 16',
        ort: 'Bottmingen',
        veranstalter: 'Senioren für Senioren',
        kategorie: 'Senioren',
        preis: 'Fr. 15.–',
        anmeldung: 'bis Mittwoch 12 Uhr',
        beschreibung:
          'Am 24.9.26 findet unser nächster Mittagstisch statt. Anmeldung bis spätestens 12.00, Mittwoch, 23. September.',
        dokumente: [],
        weitereTermine: ['2026-09-24', '2026-10-29'],
        traktandenLink: null,
        kanonisch: 'https://www.example.ch/kanonisch',
        verfahren: 'weblication'
      },
      anhaenge: [
        {
          bezeichnung: 'Flyer',
          url: 'https://www.example.ch/f.pdf',
          typ: 'pdf',
          gelesen: true,
          text: 'x'
        }
      ],
      traktanden: null,
      transport: 'crawler',
      anfragen: 1
    }
    const { payload, befund } = detailPayload(
      g,
      gelesen,
      'Bottmingen',
      HEUTE,
      HEUTE_OBJ,
      false
    )
    expect(payload).toMatchObject({
      termine: ['2026-09-24', '2026-10-29'],
      von: '2026-09-24',
      bis: '2026-10-29',
      rhythmus: 'monatlich',
      anker: 'frist',
      anker_am: '2026-09-23',
      frist_am: '2026-09-23',
      lokalitaet: 'Gemeindestube',
      ort: 'Bottmingen',
      ort_ausserhalb: false,
      preis: 'Fr. 15.–',
      url_kanonisch: 'https://www.example.ch/kanonisch'
    })
    expect(payload.hinweise).toContain('Über den Crawler gelesen')
    expect(befund.anker).toBe('frist')
  })
})

describe('dauerangeboteHeute', () => {
  it('eines je Woche, keines wenn diese Woche schon eines lag, der Rest gezaehlt', () => {
    const routinen = [
      { id: 'a', zuletzt_vorgelegt_am: null, dauerangebot: null },
      {
        id: 'b',
        zuletzt_vorgelegt_am: '2026-01-01',
        dauerangebot: 'intervall' as const
      },
      { id: 'c', zuletzt_vorgelegt_am: null, dauerangebot: 'nie' as const }
    ]
    expect(dauerangeboteHeute(routinen, HEUTE)).toEqual({
      vorgelegt: ['a'],
      warten: 1
    })
    expect(
      dauerangeboteHeute(
        [
          ...routinen,
          {
            id: 'd',
            zuletzt_vorgelegt_am: '2026-09-15',
            dauerangebot: 'intervall' as const
          }
        ],
        HEUTE
      )
    ).toEqual({ vorgelegt: [], warten: 2 })
  })
})

describe('raeumeAnlaesseAuf und Newskontext', () => {
  it('verfaellt und loescht nach den Regeln des Tischs', async () => {
    const d = dienst([
      {
        id: 'v',
        entscheid: 'offen',
        vorschlag: true,
        anker_am: '2026-09-10',
        zuletzt_gesehen_am: '2026-09-17',
        dauerangebot: null
      },
      {
        id: 'l',
        entscheid: 'offen',
        vorschlag: null,
        anker_am: null,
        zuletzt_gesehen_am: '2026-08-01',
        dauerangebot: null
      },
      {
        id: 'b',
        entscheid: 'offen',
        vorschlag: null,
        anker_am: null,
        zuletzt_gesehen_am: '2026-09-17',
        dauerangebot: null
      }
    ])
    expect(await raeumeAnlaesseAuf(d, HEUTE, logger)).toEqual({
      geloescht: 1,
      verfallen: 1
    })
    expect(d.updateMany).toHaveBeenCalledWith(['v'], { entscheid: 'verfallen' })
    expect(d.deleteMany).toHaveBeenCalledWith(['l'])
  })

  it('der Newskontext sind die Titel der Newsseite der letzten zwei Wochen', async () => {
    const mitteilungen = {
      readByQuery: vi.fn(async () => [
        { titel: 'Fernwärme' },
        { titel: 'Wahllokal' }
      ])
    }
    expect(await ladeNewsKontext(mitteilungen, 'g1', HEUTE)).toEqual([
      'Fernwärme',
      'Wahllokal'
    ])
    const query = (
      mitteilungen.readByQuery.mock.calls as unknown as Array<
        [{ filter: Record<string, unknown> }]
      >
    )[0]?.[0] as { filter: Record<string, unknown> }
    expect(query.filter).toMatchObject({
      gemeinde: { _eq: 'g1' },
      veranstaltung_am: { _null: true },
      publiziert_am: { _gte: '2026-09-04' }
    })
  })
})

describe('sichteAnlaesse', () => {
  const zeile = {
    id: 'a1',
    titel: 'Markt des Alterns',
    anker: 'einmalig',
    anker_am: '2026-09-25',
    anker_grund: 'Einmaliger Anlass.',
    termine: ['2026-09-25'],
    zeit: '13:00–18:00',
    lokalitaet: 'KUSPO',
    ort: 'Pratteln',
    ort_ausserhalb: false,
    veranstalter: 'Gemeinde Pratteln',
    kategorie: null,
    preis: null,
    anmeldung: null,
    frist_am: null,
    traktanden: null,
    dokumente: [],
    beschreibung: 'Organisationen präsentieren sich.',
    text_abgeschnitten: false,
    hinweise: null
  }

  function kontext(antwort: unknown) {
    const anlaesse = dienst([zeile])
    const send = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(antwort) }],
      stop_reason: 'end_turn'
    }))
    return {
      anlaesse,
      send,
      kontext: {
        anlaesse,
        mitteilungen: { readByQuery: vi.fn(async () => []) },
        hinweise: {
          readByQuery: vi.fn(async () => []),
          createOne: vi.fn(async () => 'h1')
        },
        meldungen: { readByQuery: vi.fn(async () => []) },
        regelzeilen: [],
        sichtungsregeln: { text: '', nummern: new Map() },
        heute: HEUTE,
        logger,
        send: send as never
      }
    }
  }

  it('schreibt das Urteil je Anlass zurueck und zaehlt die Vorschlaege', async () => {
    const {
      anlaesse,
      kontext: k,
      send
    } = kontext({
      urteile: [
        {
          nummer: 1,
          vorschlag: true,
          begruendung: 'Gemeinde als Veranstalterin.',
          empfehlung: null,
          empfehlung_regel: null
        }
      ]
    })
    const ergebnis = await sichteAnlaesse(
      ['a1'],
      { id: 'g1', name: 'Pratteln' },
      k
    )
    expect(ergebnis).toEqual({
      vorschlaege: 1,
      weitergereicht: 0,
      fehler: null
    })
    expect(anlaesse.geaendert).toEqual([
      {
        id: 'a1',
        payload: {
          vorschlag: true,
          vorschlag_begruendung: 'Gemeinde als Veranstalterin.'
        }
      }
    ])
    const anfrage = (
      send.mock.calls as unknown as Array<
        [{ messages: Array<{ content: string }> }]
      >
    )[0]?.[0] as { messages: Array<{ content: string }> }
    expect(anfrage.messages[0]?.content).toContain(
      '[Anker: Einmalig am 25. September 2026 · 13:00–18:00 · KUSPO, Pratteln] "Markt des Alterns"'
    )
  })

  it('ein Modellfehler laesst das Urteil leer und wird gemeldet', async () => {
    const { anlaesse, kontext: k } = kontext({ nicht: 'json wie erwartet' })
    const ergebnis = await sichteAnlaesse(
      ['a1'],
      { id: 'g1', name: 'Pratteln' },
      k
    )
    expect(ergebnis.vorschlaege).toBe(0)
    expect(ergebnis.fehler).not.toBeNull()
    expect(anlaesse.geaendert).toHaveLength(0)
  })

  it('ohne Kandidaten kein Aufruf', async () => {
    const { kontext: k, send } = kontext({})
    expect(await sichteAnlaesse([], { id: 'g1', name: 'Pratteln' }, k)).toEqual(
      { vorschlaege: 0, weitergereicht: 0, fehler: null }
    )
    expect(send).not.toHaveBeenCalled()
  })
})

describe('kuerzeFelder', () => {
  // Gemessen am ersten Lauf (20.09.2026): Prattelns „Lümmel-Wiesn" ging
  // verloren, weil ein Feld einen Buchstaben zu lang war — Directus wies die
  // ganze Zeile ab. Ein Anlass fiel aus dem Lauf, damit eine Zeitangabe
  // vollstaendig bleiben konnte; das ist der falsche Handel.
  it('kuerzt auf die Spaltenbreite und sagt, welches Feld', () => {
    const { felder, hinweise } = kuerzeFelder({
      zeit: 'Samstag, 11.00 Uhr bis Sonntag, 03.00 Uhr, Einlass ab 10.30 Uhr',
      lokalitaet: 'Trotte'
    })
    expect((felder['zeit'] as string).length).toBe(40)
    expect(felder['lokalitaet']).toBe('Trotte')
    expect(hinweise).toEqual(['Zeit gekürzt.'])
  })

  it('kuerzt den Schluessel still — er steht auf keinem Tisch', () => {
    const { felder, hinweise } = kuerzeFelder({ schluessel: 'x'.repeat(400) })
    expect((felder['schluessel'] as string).length).toBe(300)
    expect(hinweise).toEqual([])
  })

  it('laesst kurze Werte und Nicht-Zeichenketten in Ruhe', () => {
    const { felder, hinweise } = kuerzeFelder({ ort: 'Pratteln', preis: null })
    expect(felder).toEqual({ ort: 'Pratteln', preis: null })
    expect(hinweise).toEqual([])
  })
})

// Die Redaktion am 21. September 2026: ist die Anmeldefrist vorbei UND die
// Anmeldung zwingend, kann niemand mehr hin — der Hinweis gehoert unter
// „Weitere mit Anker", nicht in die Vorschlaege.
describe('verpassteAnmeldung', () => {
  it('stuft herab, wo die Frist vorbei und die Teilnahme angemeldet ist', () => {
    expect(
      verpassteAnmeldung({ frist_am: '2026-09-17', zugang: 'programm' }, HEUTE)
    ).toContain('17. September 2026')
  })

  it('laesst einen Anlass in Ruhe, zu dem man auch spontan gehen kann', () => {
    // Eine Ausstellung mit Anmeldung fuer die Fuehrung bleibt ein Vorschlag.
    expect(
      verpassteAnmeldung({ frist_am: '2026-09-17', zugang: 'offen' }, HEUTE)
    ).toBeNull()
  })

  it('stuft auch bei unbekanntem Zugang herab — ein `frist_am` entsteht nur aus „Anmeldung bis"', () => {
    expect(
      verpassteAnmeldung({ frist_am: '2026-09-17', zugang: 'unbekannt' }, HEUTE)
    ).not.toBeNull()
  })

  it('ruehrt eine Frist an, die noch laeuft, gar nicht an', () => {
    expect(
      verpassteAnmeldung({ frist_am: HEUTE, zugang: 'programm' }, HEUTE)
    ).toBeNull()
    expect(
      verpassteAnmeldung({ frist_am: '2026-09-30', zugang: 'programm' }, HEUTE)
    ).toBeNull()
    expect(verpassteAnmeldung({ frist_am: null }, HEUTE)).toBeNull()
  })

  it('nimmt die Zeile damit aus der Sichtung', () => {
    const basis = {
      anker: 'frist' as const,
      anker_am: HEUTE,
      vorschlag: null,
      entscheid: 'offen'
    }
    expect(sichtungsKandidat(basis, HEUTE, 10)).toBe(true)
    expect(
      sichtungsKandidat(
        { ...basis, frist_am: '2026-09-17', zugang: 'programm' },
        HEUTE,
        10
      )
    ).toBe(false)
  })
})
