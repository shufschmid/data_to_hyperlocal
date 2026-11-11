import type Anthropic from '@anthropic-ai/sdk'
import { createError } from '@directus/errors'
import { describe, expect, it } from 'vitest'
import { BuschtelefonFehler } from '../shared/buschtelefon/client'
import {
  ClaudeFormatError,
  ClaudeTruncatedError,
  type MessageSender
} from '../shared/claude'
import { liesFundeAntwort } from '../shared/buschtelefon/parse'
import { istEntfernt, type Fund } from '../shared/buschtelefon/typen'
import { datengrundlageVon, fundFelder, leereMaterial } from './buschtelefon'
import {
  brauchtEntwurf,
  fehlerKennung,
  fehlerSatz,
  fundBezeichnung,
  FundOhneGemeinde,
  FundOhneMaterial,
  KEIN_ENTWURF,
  MaterialGenuegtNicht,
  schreibeFundMeldung,
  schreibeFundMeldungen,
  ueberarbeiteBuschtelefon,
  type FundRohzeile
} from './buschtelefonmeldungen'
import {
  fixture,
  modell,
  sammlung,
  SAUBERE_MELDUNG,
  STILL
} from './buschtelefon.testhilfe'
import { EIGENE_HINWEIS, ERGAENZUNG_HINWEIS } from './ergaenzung'
import {
  LINK_WARNUNG,
  NACHNAMEN_WARNUNG,
  TELEFON_WARNUNG,
  UNBESTAETIGT_WARNUNG
} from './warnungen'

const antwort = liesFundeAntwort(fixture('funde.json'))

function fund(kennung: string): Fund {
  const f = antwort.funde.find((x) => x.kennung === kennung)
  if (f === undefined || istEntfernt(f)) throw new Error(`kein Fund ${kennung}`)
  return f
}

const GEMEINDE = { id: 'g-1', name: 'Musterdorf' }

function zeile(
  kennung: string,
  mehr: Partial<FundRohzeile> = {},
  quellenUrl: string | null = 'https://www.facebook.com/groups/1000000001'
): FundRohzeile {
  return {
    id: `id-${kennung.slice(-1)}`,
    entscheid: 'offen',
    material_geloescht_am: null,
    aktualisiert_am: null,
    entwurf_bedenken: null,
    ...(fundFelder(fund(kennung), quellenUrl, null) as object),
    gemeinde: GEMEINDE,
    ...mehr
  } as FundRohzeile
}

const SPERRUNG = 'fb:1000000001_2000000002'
const FLYER = 'fb:1000000001_2000000001'
const GESCHLOSSEN = 'fb:1000000002_2000000004'

function dienste(m = modell(), meldungen = sammlung('meldungen')) {
  const funde = sammlung('funde', [
    { id: 'id-1' },
    { id: 'id-2' },
    { id: 'id-3' },
    { id: 'id-4' }
  ])
  return {
    m,
    funde,
    meldungen,
    d: {
      funde,
      meldungen,
      regeln: ['Schreibe «Bibo».'],
      logger: STILL,
      send: m.send
    }
  }
}

describe('schreibeFundMeldung', () => {
  it('schreibt einen Entwurf und laesst den Entscheid offen', async () => {
    const { d, m, funde, meldungen } = dienste()
    const ergebnis = await schreibeFundMeldung(d, zeile(SPERRUNG))

    expect(m.aufrufe).toHaveLength(1)
    expect(m.aufrufe[0]?.prompt).toContain('Redaktionelle Vorgaben:')
    const artikel = meldungen.finde(ergebnis.meldung)
    expect(artikel).toMatchObject({
      buschtelefon_fund: 'id-2',
      gemeinde: 'g-1',
      status: 'entwurf',
      verarbeitung: 'idle',
      titel: SAUBERE_MELDUNG.titel,
      zeit_warnungen: null,
      termin: null,
      wichtig: null
    })
    expect(artikel['text']).toMatch(
      /nicht unabhängig bestätigt\.\n\nQuelle: Beitrag in der Facebook-Gruppe .* <a href="https:\/\/www\.facebook\.com\/groups\/1000000001\/posts\/2000000002">Zum Beitrag<\/a>$/
    )
    // The run's draft teaches nothing and decides nothing.
    expect(funde.protokoll).toEqual([
      ['update', 'id-2', { entwurf_bedenken: null }]
    ])
    expect(funde.finde('id-2')).not.toHaveProperty('entscheid')
  })

  it('legt kein Rohmaterial in die Datengrundlage', async () => {
    const { d, meldungen } = dienste()
    const { meldung } = await schreibeFundMeldung(d, zeile(SPERRUNG))
    const grundlage = JSON.stringify(meldungen.finde(meldung)['datengrundlage'])
    expect(JSON.parse(grundlage)).toMatchObject({
      quelle: 'buschtelefon',
      kanal: 'facebook',
      sichtbarkeit: 'oeffentlich'
    })
    for (const verboten of [
      'Sandra',
      'Marc',
      'Wasserleitungsbruch',
      'Kreisel',
      SPERRUNG
    ])
      expect(grundlage).not.toContain(verboten)
  })

  it('verlinkt bei einer geschlossenen Gruppe nur die Gruppe', async () => {
    const { d, meldungen } = dienste()
    const z = zeile(
      GESCHLOSSEN,
      {},
      'https://www.facebook.com/groups/1000000002'
    )
    const { meldung } = await schreibeFundMeldung(d, z)
    const artikel = meldungen.finde(meldung)
    expect(artikel['text']).toContain('">Zur Gruppe</a>')
    expect(JSON.stringify(artikel)).not.toContain(fund(GESCHLOSSEN).link)
  })

  it('fasst genau einmal nach, wenn Herkunft oder Vorbehalt fehlen', async () => {
    const m = modell({
      meldung: (_p, aufruf) =>
        aufruf === 1
          ? {
              titel: 'Sperrung',
              lead: 'Die Strasse ist zu.',
              text: 'Niemand weiss warum.'
            }
          : SAUBERE_MELDUNG
    })
    const { d, meldungen } = dienste(m)
    const { warnungen, meldung } = await schreibeFundMeldung(d, zeile(SPERRUNG))
    expect(m.aufrufe).toHaveLength(2)
    expect(m.aufrufe[1]?.prompt).toContain('nicht unabhaengig bestaetigt')
    expect(warnungen).toEqual([])
    expect(meldungen.finde(meldung)['titel']).toBe(SAUBERE_MELDUNG.titel)
  })

  it('laesst die Warnung stehen, wenn auch das Nachfassen nichts bringt', async () => {
    const m = modell({
      meldung: () => ({
        titel: 'Sperrung',
        lead: 'In einer Facebook-Gruppe wird eine Sperrung gemeldet.',
        text: 'Mehr ist nicht bekannt.'
      })
    })
    const { d } = dienste(m)
    const { warnungen } = await schreibeFundMeldung(d, zeile(SPERRUNG))
    expect(m.aufrufe).toHaveLength(2)
    expect(warnungen).toEqual([UNBESTAETIGT_WARNUNG])
  })

  it('haelt Bedenken und Namensfunde vom Artikel fern und legt sie auf den Fund', async () => {
    const m = modell({
      meldung: () => ({
        ...SAUBERE_MELDUNG,
        lead: 'Sandra Muster fragt in einer Facebook-Gruppe nach einer Sperrung.',
        bedenken: 'Nur ein Kommentar nennt den Grund.'
      })
    })
    const { d, funde, meldungen } = dienste(m)
    const z = zeile(SPERRUNG, {
      text: 'Ich bin Sandra Muster. Warum ist die Hauptstrasse gesperrt?'
    })
    const { meldung, bedenken, warnungen } = await schreibeFundMeldung(d, z)

    expect(warnungen).toEqual([NACHNAMEN_WARNUNG])
    const artikel = meldungen.finde(meldung)
    expect(artikel['zeit_warnungen']).toEqual([NACHNAMEN_WARNUNG])
    // What leaves through the Pruefsiegel names no person and no reservation.
    expect(JSON.stringify(artikel['zeit_warnungen'])).not.toMatch(
      /Muster|Kommentar/
    )
    expect(bedenken).toContain('Nur ein Kommentar nennt den Grund.')
    expect(bedenken).toContain('«Muster»')
    expect(funde.finde('id-2')['entwurf_bedenken']).toBe(bedenken)
  })

  it('macht aus {"genuegt": false} eine eigene Absage und schreibt nichts', async () => {
    const m = modell({ meldung: () => ({ genuegt: false }) })
    const { d, meldungen, funde } = dienste(m)
    await expect(
      schreibeFundMeldung(d, zeile(SPERRUNG))
    ).rejects.toBeInstanceOf(MaterialGenuegtNicht)
    expect(meldungen.zeilen).toHaveLength(0)
    expect(funde.protokoll).toEqual([])
  })

  it('verweigert ohne Gemeinde und ohne Material', async () => {
    const { d, m } = dienste()
    await expect(
      schreibeFundMeldung(d, zeile(SPERRUNG, { gemeinde: null }))
    ).rejects.toBeInstanceOf(FundOhneGemeinde)
    const leer = zeile(
      SPERRUNG,
      leereMaterial('2026-11-20T00:00:00Z') as Partial<FundRohzeile>
    )
    await expect(schreibeFundMeldung(d, leer)).rejects.toBeInstanceOf(
      FundOhneMaterial
    )
    expect(m.aufrufe).toHaveLength(0)
  })

  it('schreibt mit ergaenzenden Angaben, auch wenn das Material geleert ist', async () => {
    const { d, m, meldungen } = dienste()
    const leer = zeile(
      SPERRUNG,
      leereMaterial('2026-11-20T00:00:00Z') as Partial<FundRohzeile>
    )
    const { meldung, warnungen } = await schreibeFundMeldung(d, leer, {
      beitrag: {
        ergaenzung: 'Die Gemeinde bestätigt die Sperrung.',
        eigene: null
      }
    })
    expect(m.aufrufe[0]?.prompt).toContain(
      'Die Gemeinde bestätigt die Sperrung.'
    )
    expect(warnungen).toEqual([ERGAENZUNG_HINWEIS])
    expect(meldungen.finde(meldung)['datengrundlage']).toMatchObject({
      ergaenzung: 'Die Gemeinde bestätigt die Sperrung.'
    })
  })

  it('nimmt eine eigene Meldung ohne Modellaufruf, mit der Quellenzeile des Codes', async () => {
    const { d, m, meldungen, funde } = dienste()
    const { meldung, warnungen } = await schreibeFundMeldung(
      d,
      zeile(SPERRUNG, { entwurf_bedenken: 'alt' }),
      {
        beitrag: {
          ergaenzung: null,
          eigene: {
            titel: 'Eigener Titel',
            lead: 'Eigener Lead.',
            text: 'Eigener Text.'
          }
        }
      }
    )
    expect(m.aufrufe).toHaveLength(0)
    expect(warnungen).toEqual([EIGENE_HINWEIS])
    const artikel = meldungen.finde(meldung)
    expect(artikel['text']).toMatch(
      /^Eigener Text\.\n\nQuelle: Beitrag in der Facebook-Gruppe/
    )
    expect(artikel['datengrundlage']).toMatchObject({
      eigene: true,
      quelle: 'buschtelefon'
    })
    expect(funde.finde('id-2')['entwurf_bedenken']).toBeNull()
  })

  it('prueft auch eine eigene Meldung auf Personen und Adressen — die Werte nur auf dem Fund', async () => {
    const { d, m, meldungen, funde } = dienste()
    const mitName = zeile(SPERRUNG, {
      text: 'Ich bin Sandra Muster. Warum ist die Hauptstrasse gesperrt?'
    })
    const { meldung, warnungen, bedenken } = await schreibeFundMeldung(
      d,
      mitName,
      {
        beitrag: {
          ergaenzung: null,
          eigene: {
            titel: 'Musterdorf: Hauptstrasse gesperrt',
            lead: 'Sandra Muster meldet eine Sperrung.',
            text: 'Auskunft unter 079 123 45 67 und auf https://chat.whatsapp.com/abc.'
          }
        }
      }
    )
    expect(m.aufrufe).toHaveLength(0)
    expect(warnungen).toEqual(
      expect.arrayContaining([
        EIGENE_HINWEIS,
        LINK_WARNUNG,
        TELEFON_WARNUNG,
        NACHNAMEN_WARNUNG
      ])
    )
    const artikel = meldungen.finde(meldung)
    expect(artikel['zeit_warnungen']).toEqual(warnungen)
    for (const w of warnungen) {
      expect(w).not.toContain('Muster')
      expect(w).not.toContain('whatsapp')
      expect(w).not.toContain('079')
    }
    expect(bedenken).toContain('«Muster»')
    expect(bedenken).toContain('https://chat.whatsapp.com/abc')
    expect(funde.finde('id-2')['entwurf_bedenken']).toBe(bedenken)
  })

  it('prueft die Kontakte einer eigenen Meldung auch, wenn das Material geleert ist', async () => {
    const { d } = dienste()
    const leer = zeile(
      SPERRUNG,
      leereMaterial('2026-11-20T00:00:00Z') as Partial<FundRohzeile>
    )
    const { warnungen, bedenken } = await schreibeFundMeldung(d, leer, {
      beitrag: {
        ergaenzung: null,
        eigene: {
          titel: 'Titel',
          lead: 'Lead.',
          text: 'Mail an petra@example.ch.'
        }
      }
    })
    expect(warnungen).toEqual([
      EIGENE_HINWEIS,
      'Die Meldung nennt eine E-Mail-Adresse — bei einer Privatperson entfernen.'
    ])
    expect(bedenken).toBeNull()
  })
})

describe('Fehler — nie mit dem, was ein Modell oder ein Anbieter sagte', () => {
  it('sagt die eigenen Absagen und die der Tuer wortgleich', () => {
    expect(fehlerSatz(new FundOhneGemeinde())).toBe(
      new FundOhneGemeinde().message
    )
    expect(fehlerSatz(new MaterialGenuegtNicht())).toBe(
      new MaterialGenuegtNicht().message
    )
    const tuer = new BuschtelefonFehler(
      'server',
      'Das Buschtelefon antwortet mit HTTP 500.'
    )
    expect(fehlerSatz(tuer)).toBe('Das Buschtelefon antwortet mit HTTP 500.')
  })

  it('macht aus einer Modellantwort und einem Anbieterfehler einen neutralen Satz', () => {
    const roh = '{"titel": "Sandra Muster sucht Zeugen'
    const format = new ClaudeFormatError(roh)
    expect(fehlerSatz(format)).toBe('Die Antwort des Modells war nicht lesbar.')
    expect(fehlerKennung(format)).toEqual({
      name: 'ClaudeFormatError',
      code: null
    })
    expect(JSON.stringify(fehlerKennung(format))).not.toContain('Sandra')
    expect(fehlerSatz(new ClaudeTruncatedError(1500))).toBe(
      'Die Antwort des Modells brach an der Höchstlänge ab (1500 Tokens).'
    )
    const anbieter = Object.assign(
      new Error('400 {"error":{"message":"prompt: Sandra Muster …"}}'),
      { name: 'BadRequestError', status: 400 }
    )
    expect(fehlerSatz(anbieter)).toBe(
      'Unerwarteter Fehler (400) — Einzelheiten im Protokoll.'
    )
    expect(fehlerKennung(anbieter)).toEqual({
      name: 'BadRequestError',
      code: 400
    })
    expect(fehlerSatz(new Error('irgendwas mit Sandra'))).toBe(
      'Unerwarteter Fehler — Einzelheiten im Protokoll.'
    )
    expect(fehlerSatz('nur ein String')).toBe(
      'Unerwarteter Fehler — Einzelheiten im Protokoll.'
    )
  })

  it('nennt einen Directus-Fehler mit seinem Satz und seinem Code', () => {
    const Doppelt = createError(
      'RECORD_NOT_UNIQUE',
      'Value for field "buschtelefon_fund" in collection "meldungen" has to be unique.',
      400
    )
    expect(fehlerSatz(new Doppelt())).toBe(
      'Value for field "buschtelefon_fund" in collection "meldungen" has to be unique. (RECORD_NOT_UNIQUE)'
    )
  })
})

describe('brauchtEntwurf', () => {
  const frisch = { aktualisiert_am: null, entwurf_bedenken: null }

  it('schuldet einer Zeile ohne Meldung einen Entwurf', () => {
    expect(brauchtEntwurf(frisch, [])).toBe(true)
  })

  it('schreibt nicht neben eine Meldung, die nicht verworfen ist', () => {
    expect(
      brauchtEntwurf(frisch, [{ status: 'entwurf', date_created: null }])
    ).toBe(false)
    expect(
      brauchtEntwurf(frisch, [
        { status: 'verworfen', date_created: null },
        { status: 'publiziert', date_created: null }
      ])
    ).toBe(false)
  })

  it('schreibt einen verworfenen Entwurf nicht jeden Mittag neu', () => {
    expect(
      brauchtEntwurf(frisch, [
        { status: 'verworfen', date_created: '2026-11-10T12:00:00Z' }
      ])
    ).toBe(false)
  })

  it('schreibt neu, wenn der Fund sich seit dem verworfenen Entwurf geaendert hat', () => {
    const geaendert = {
      aktualisiert_am: '2026-11-11T11:00:00Z',
      entwurf_bedenken: null
    }
    expect(
      brauchtEntwurf(geaendert, [
        { status: 'verworfen', date_created: '2026-11-10T11:00:00Z' }
      ])
    ).toBe(true)
    expect(
      brauchtEntwurf(geaendert, [
        { status: 'verworfen', date_created: '2026-11-11T11:05:00Z' }
      ])
    ).toBe(false)
  })

  it('fragt den Schreiber nicht zweimal nach demselben Stand', () => {
    expect(
      brauchtEntwurf(
        { aktualisiert_am: null, entwurf_bedenken: KEIN_ENTWURF },
        []
      )
    ).toBe(false)
  })
})

describe('schreibeFundMeldungen', () => {
  it('schreibt bis zum Deckel und nennt den Rest ohne Wortlaut', async () => {
    const { d, m } = dienste()
    const ergebnis = await schreibeFundMeldungen(
      d,
      [zeile(SPERRUNG), zeile(FLYER), zeile('fb:1000000001_2000000003')],
      2
    )
    expect(ergebnis.geschrieben).toBe(2)
    expect(m.aufrufe).toHaveLength(2)
    expect(ergebnis.wartend).toHaveLength(1)
    expect(ergebnis.wartend[0]).toMatch(
      /^Musterdorf: Beitrag aus Facebook-Gruppe/
    )
    expect(ergebnis.wartend[0]).not.toMatch(/Achtung|Polizei/)
  })

  it('zaehlt Vorschlaege ohne Gemeinde und schreibt ihnen nichts', async () => {
    const { d, m } = dienste()
    const ergebnis = await schreibeFundMeldungen(d, [
      zeile(GESCHLOSSEN, { gemeinde: null }),
      zeile(SPERRUNG)
    ])
    expect(ergebnis).toMatchObject({
      geschrieben: 1,
      ohneGemeinde: 1,
      fehler: []
    })
    expect(m.aufrufe).toHaveLength(1)
  })

  it('laesst Zeilen mit Meldung aus', async () => {
    const meldungen = sammlung('meldungen', [
      {
        id: 'm-1',
        buschtelefon_fund: 'id-2',
        status: 'entwurf',
        date_created: null
      }
    ])
    const { d, m } = dienste(modell(), meldungen)
    const ergebnis = await schreibeFundMeldungen(d, [zeile(SPERRUNG)])
    expect(ergebnis.geschrieben).toBe(0)
    expect(m.aufrufe).toHaveLength(0)
  })

  it('merkt sich die Absage des Schreibers auf der Zeile — kein Fehler', async () => {
    const m = modell({ meldung: () => ({ genuegt: false }) })
    const { d, funde } = dienste(m)
    const ergebnis = await schreibeFundMeldungen(d, [zeile(SPERRUNG)])
    expect(ergebnis).toMatchObject({
      geschrieben: 0,
      ohneMeldung: 1,
      fehler: []
    })
    expect(funde.finde('id-2')['entwurf_bedenken']).toBe(KEIN_ENTWURF)
  })

  it('nennt einen gescheiterten Entwurf und schreibt die anderen', async () => {
    const m = modell({
      meldung: (_p, aufruf) => {
        if (aufruf === 1) throw new Error('Modell nicht erreichbar')
        return SAUBERE_MELDUNG
      }
    })
    const { d } = dienste(m)
    const ergebnis = await schreibeFundMeldungen(d, [
      zeile(SPERRUNG),
      zeile(FLYER)
    ])
    expect(ergebnis.geschrieben).toBe(1)
    expect(ergebnis.fehler).toHaveLength(1)
    expect(ergebnis.fehler[0]).toMatch(
      /^Musterdorf: Beitrag aus .* — Entwurf fehlgeschlagen: Unerwarteter Fehler — Einzelheiten im Protokoll\.$/
    )
    expect(ergebnis.fehler[0]).not.toContain('Hauptstrasse')
  })

  it('gibt eine unlesbare Modellantwort weder in den Lauf noch ins Protokoll', async () => {
    const roh = 'Sandra Muster von der Hauptstrasse 12 sucht Zeugen'
    const kaputt: MessageSender = async () =>
      ({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: roh, citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }
      }) as unknown as Anthropic.Message
    const protokoll: unknown[] = []
    const { d } = dienste()
    const ergebnis = await schreibeFundMeldungen(
      {
        ...d,
        send: kaputt,
        logger: {
          info: () => undefined,
          warn: (e: unknown, nachricht?: string) => {
            protokoll.push(e, nachricht)
          }
        }
      },
      [zeile(SPERRUNG)]
    )
    expect(ergebnis.fehler).toHaveLength(1)
    expect(ergebnis.fehler[0]).toContain(
      'Die Antwort des Modells war nicht lesbar.'
    )
    const alles = JSON.stringify([ergebnis, protokoll])
    for (const verboten of [
      'Sandra',
      'Muster von',
      'Hauptstrasse 12',
      'Zeugen'
    ])
      expect(alles).not.toContain(verboten)
    expect(protokoll).toContainEqual({ name: 'ClaudeFormatError', code: null })
  })

  it('benennt einen Fund ohne seinen Wortlaut', () => {
    expect(fundBezeichnung(zeile(SPERRUNG))).toBe(
      'Musterdorf: Beitrag aus Facebook-Gruppe «Du bisch vo Musterdorf, wenn …» vom Sonntag, 8. November 2026'
    )
  })
})

describe('ueberarbeiteBuschtelefon', () => {
  const meldung = {
    id: 'm-1',
    titel: 'Alt',
    lead: 'Alter Lead.',
    text: 'Alter Text.\n\nQuelle: Beitrag in der Facebook-Gruppe «X» – nicht unabhängig bestätigt. <a href="https://example.ch">Zum Beitrag</a>'
  }

  it('nimmt die Quellenzeile vorher ab und haengt sie danach wieder an', async () => {
    const meldungen = sammlung('meldungen', [
      { ...meldung, verarbeitung: 'laeuft' }
    ])
    const { d, m, funde } = dienste(
      modell({
        meldung: () => ({ ...SAUBERE_MELDUNG, bedenken: 'Vorsicht.' })
      }),
      meldungen
    )
    const warnungen = await ueberarbeiteBuschtelefon(
      d,
      meldung,
      zeile(SPERRUNG),
      'Kürzer.'
    )
    expect(warnungen).toEqual([])
    expect(m.aufrufe[0]?.prompt).toContain('Alter Text.')
    expect(m.aufrufe[0]?.prompt).not.toContain('https://example.ch')
    expect(m.aufrufe[0]?.prompt).toContain('Kürzer.')
    const danach = meldungen.finde('m-1')
    expect(danach).toMatchObject({
      verarbeitung: 'idle',
      anweisung: null,
      fehler: null
    })
    expect(String(danach['text']).match(/Quelle: /g)).toHaveLength(1)
    expect(funde.finde('id-2')['entwurf_bedenken']).toBe('Vorsicht.')
  })

  it('fuehrt auch die Datengrundlage nach, wenn die Gruppe inzwischen geschlossen ist', async () => {
    const oeffentlich = zeile(SPERRUNG)
    const meldungen = sammlung('meldungen', [
      {
        ...meldung,
        verarbeitung: 'laeuft',
        datengrundlage: {
          ...datengrundlageVon(oeffentlich),
          ergaenzung: 'Die Gemeinde bestätigt.'
        }
      }
    ])
    const { d } = dienste(modell(), meldungen)
    const geschlossen = zeile(SPERRUNG, { quelle_sichtbarkeit: 'geschlossen' })
    await ueberarbeiteBuschtelefon(
      d,
      meldung,
      geschlossen,
      'Kürzer.',
      'Die Gemeinde bestätigt.'
    )
    const danach = meldungen.finde('m-1')
    expect(danach['text']).toContain('">Zur Gruppe</a>')
    expect(danach['datengrundlage']).toEqual({
      quelle: 'buschtelefon',
      kanal: 'facebook',
      quelle_name: 'Facebook-Gruppe «Du bisch vo Musterdorf, wenn …»',
      url: 'https://www.facebook.com/groups/1000000001',
      sichtbarkeit: 'geschlossen',
      ergaenzung: 'Die Gemeinde bestätigt.'
    })
    expect(JSON.stringify(danach)).not.toContain(fund(SPERRUNG).link)
  })

  it('verweigert, wenn das Material geleert ist und keine Angaben der Redaktion vorliegen', async () => {
    const { d } = dienste()
    const leer = zeile(
      SPERRUNG,
      leereMaterial('2026-11-20T00:00:00Z') as Partial<FundRohzeile>
    )
    await expect(
      ueberarbeiteBuschtelefon(d, meldung, leer, 'Kürzer.')
    ).rejects.toBeInstanceOf(FundOhneMaterial)
  })
})
