import { createError } from '@directus/errors'
import { describe, expect, it, vi } from 'vitest'
import { BuschtelefonFehler } from '../../shared/buschtelefon/client'
import { liesFundeAntwort } from '../../shared/buschtelefon/parse'
import { istEntfernt, type Fund } from '../../shared/buschtelefon/typen'
import { fundFelder, leereMaterial } from '../../redaktion/buschtelefon'
import {
  fixture,
  modell,
  sammlung,
  ZUGANG_ENV,
  type Sammlung
} from '../../redaktion/buschtelefon.testhilfe'
import {
  EIGENE_HINWEIS,
  leseBeitrag,
  OHNE_BEITRAG
} from '../../redaktion/ergaenzung'
import {
  ABLEHNUNGSGRUENDE,
  alsAntwort,
  fehlerKennung,
  gibFundZurueck,
  istEigeneAntwort,
  LAUF_ABGEBROCHEN,
  laufAntwort,
  laufFehlerText,
  lehneFundAb,
  leererLauf,
  leseAblehnung,
  leseBegruendung,
  leseGemeinde,
  markiereUebernommen,
  ordneGemeindeZu,
  reicheFundWeiter,
  uebernehmeFund,
  ueberarbeiteFundMeldung,
  verdrahteBuschtelefon,
  WEITERREICH_FELDER,
  type BuschtelefonUmgebung
} from './buschtelefon'

// The Buschtelefon desk's decisions, against in-memory collections and the
// contract's fixtures. Nothing here touches Directus, the door or a model.

const antwort = liesFundeAntwort(fixture('funde.json'))

/** What Directus throws from `readOne` for a missing or unreadable row — a `createError` class. */
const Verboten = createError('FORBIDDEN', 'Forbidden', 403)
const UngueltigeId = createError('INVALID_ID', 'Ungueltige Id.', 400)

function fund(kennung: string): Fund {
  const f = antwort.funde.find((x) => x.kennung === kennung)
  if (f === undefined || istEntfernt(f)) throw new Error(`kein Fund ${kennung}`)
  return f
}

const SPERRUNG = 'fb:1000000001_2000000002'
const GESCHLOSSEN = 'fb:1000000002_2000000004'
const JETZT = '2026-11-11T12:30:00.000Z'
const GEMEINDEN = [
  { id: 'g-1', name: 'Musterdorf', aktiv: true },
  { id: 'g-2', name: 'Nachbardorf', aktiv: true },
  { id: 'g-3', name: 'Fernweiler', aktiv: false }
]

type Zeile = Record<string, unknown>

/** `readOne` as Directus answers it: the row, or a 403 — never null. */
function mitReadOne(s: Sammlung) {
  return {
    ...s,
    readOne: async (id: string, query: Zeile) => {
      const [zeile] = await s.readByQuery({
        ...query,
        filter: { id: { _eq: id } }
      })
      if (zeile === undefined) throw new Verboten()
      return zeile
    }
  }
}

function tisch(
  zeilen: Zeile[] = [],
  meldungen: Zeile[] = [],
  m = modell()
): {
  funde: ReturnType<typeof mitReadOne>
  meldungen: Sammlung
  hinweise: Sammlung
  gemeinden: Sammlung
  m: ReturnType<typeof modell>
} {
  return {
    funde: mitReadOne(sammlung('funde', zeilen, { gemeinde: GEMEINDEN })),
    meldungen: sammlung('meldungen', meldungen),
    hinweise: sammlung('hinweise'),
    gemeinden: sammlung('gemeinden', GEMEINDEN),
    m
  }
}

function zeile(kennung: string, mehr: Zeile = {}): Zeile {
  return {
    id: 'f-1',
    entscheid: 'offen',
    entschieden_am: null,
    material_geloescht_am: null,
    aktualisiert_am: null,
    entwurf_bedenken: null,
    vorschlag_begruendung: 'Betrifft viele im Dorf.',
    ...fundFelder(
      fund(kennung),
      'https://www.facebook.com/groups/1000000001',
      'g-1'
    ),
    ...mehr
  }
}

describe('die Koerper der drei Entscheide', () => {
  it('kennt genau die sechs Gruende der Redaktion', () => {
    expect([...ABLEHNUNGSGRUENDE]).toEqual([
      'nicht_relevant',
      'unbestaetigt',
      'personenbezug',
      'doublette',
      'veraltet',
      'andere'
    ])
    expect(
      leseAblehnung({ grund: 'personenbezug', kommentar: '  x  ' })
    ).toEqual({ grund: 'personenbezug', kommentar: 'x' })
    expect(leseAblehnung({ grund: 'unbestaetigt' })).toEqual({
      grund: 'unbestaetigt',
      kommentar: null
    })
    // The Kanton desk's own reason is not this desk's.
    expect(leseAblehnung({ grund: 'nur_erwaehnt' })).toBeNull()
    expect(leseAblehnung(undefined)).toBeNull()
  })

  it('liest Begruendung und Gemeinde, und laesst keinen Tippfehler bis zur Datenbank', () => {
    expect(leseBegruendung({ begruendung: ' Nachfragen ' })).toBe('Nachfragen')
    expect(leseBegruendung({ begruendung: '   ' })).toBeNull()
    expect(leseBegruendung(null)).toBeNull()
    expect(
      leseGemeinde({ gemeinde: 'a1b2c3d4-0000-4000-8000-000000000001' })
    ).toBe('a1b2c3d4-0000-4000-8000-000000000001')
    expect(leseGemeinde({ gemeinde: 'aesch' })).toBeNull()
    expect(leseGemeinde({ gemeinde: 2761 })).toBeNull()
    expect(leseGemeinde({})).toBeNull()
  })

  it('macht aus den Absagen des Schreibers je eine 422 in eigenen Worten', () => {
    for (const code of [
      'FUND_OHNE_GEMEINDE',
      'FUND_OHNE_MATERIAL',
      'MATERIAL_GENUEGT_NICHT'
    ]) {
      const fehler = alsAntwort(Object.assign(new Error('x'), { code })) as {
        status: number
        code: string
      }
      expect(fehler.status).toBe(422)
      expect(fehler.code).toBe(code)
    }
    const fremd = new Error('provider')
    expect(alsAntwort(fremd)).toBe(fremd)
  })
})

describe('uebernehmeFund', () => {
  it('schreibt die Meldung, setzt den Entscheid und stempelt ihn', async () => {
    const t = tisch([zeile(SPERRUNG)])

    const ergebnis = await uebernehmeFund(
      { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
      'f-1',
      OHNE_BEITRAG,
      JETZT
    )

    expect(ergebnis.entwurf_uebernommen).toBe(false)
    expect(t.m.aufrufe.filter((a) => a.art === 'meldung')).toHaveLength(1)
    expect(t.meldungen.zeilen).toHaveLength(1)
    expect(t.meldungen.zeilen[0]).toMatchObject({
      buschtelefon_fund: 'f-1',
      gemeinde: 'g-1',
      status: 'entwurf'
    })
    expect(t.funde.finde('f-1')).toMatchObject({
      entscheid: 'uebernommen',
      entschieden_am: JETZT
    })
  })

  it('uebernimmt den Entwurf des Laufs, ohne einen zweiten Artikel zu schreiben', async () => {
    const t = tisch(
      [
        zeile(SPERRUNG, {
          entwurf_bedenken: 'Ursache nur aus einem Kommentar.'
        })
      ],
      [{ id: 'm-1', buschtelefon_fund: 'f-1', status: 'entwurf' }]
    )

    const ergebnis = await uebernehmeFund(
      { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
      'f-1',
      OHNE_BEITRAG,
      JETZT
    )

    expect(ergebnis).toEqual({
      meldung: 'm-1',
      warnungen: [],
      bedenken: 'Ursache nur aus einem Kommentar.',
      entwurf_uebernommen: true
    })
    expect(t.m.aufrufe).toHaveLength(0)
    expect(t.meldungen.zeilen).toHaveLength(1)
    expect(t.funde.finde('f-1')).toMatchObject({
      entscheid: 'uebernommen',
      entschieden_am: JETZT
    })
  })

  it('verweigert einen zweiten Artikel (409) — mit Beitrag neben einem Entwurf, und auf einer schon uebernommenen Zeile', async () => {
    const neben = tisch(
      [zeile(SPERRUNG)],
      [{ id: 'm-1', buschtelefon_fund: 'f-1', status: 'entwurf' }]
    )
    await expect(
      uebernehmeFund(
        { funde: neben.funde, meldungen: neben.meldungen, regeln: [] },
        'f-1',
        { ergaenzung: 'Die Gemeinde bestätigt die Sperrung.', eigene: null },
        JETZT
      )
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_WRITTEN' })

    const schon = tisch(
      [zeile(SPERRUNG, { entscheid: 'uebernommen' })],
      [{ id: 'm-1', buschtelefon_fund: 'f-1', status: 'publiziert' }]
    )
    await expect(
      uebernehmeFund(
        { funde: schon.funde, meldungen: schon.meldungen, regeln: [] },
        'f-1',
        OHNE_BEITRAG,
        JETZT
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(schon.meldungen.zeilen).toHaveLength(1)
  })

  it('schreibt neu, wenn die Meldung einer uebernommenen Zeile verworfen wurde', async () => {
    const t = tisch(
      [zeile(SPERRUNG, { entscheid: 'uebernommen' })],
      [{ id: 'm-1', buschtelefon_fund: 'f-1', status: 'verworfen' }]
    )
    await uebernehmeFund(
      { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
      'f-1',
      OHNE_BEITRAG,
      JETZT
    )
    expect(t.meldungen.zeilen).toHaveLength(2)
  })

  it('verweigert einen abgelehnten, weitergereichten oder verfallenen Fund (409)', async () => {
    for (const entscheid of ['abgelehnt', 'weitergereicht', 'verfallen']) {
      const t = tisch([zeile(SPERRUNG, { entscheid })])
      await expect(
        uebernehmeFund(
          { funde: t.funde, meldungen: t.meldungen, regeln: [] },
          'f-1',
          OHNE_BEITRAG,
          JETZT
        )
      ).rejects.toMatchObject({ status: 409, code: 'ALREADY_DECIDED' })
      expect(t.meldungen.zeilen).toHaveLength(0)
    }
  })

  it('verlangt zuerst die Gemeinde (422 FUND_OHNE_GEMEINDE) — auch fuer eine Meldung von Hand', async () => {
    const t = tisch([zeile(SPERRUNG, { gemeinde: null })])
    await expect(
      uebernehmeFund(
        { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
        'f-1',
        {
          ergaenzung: null,
          eigene: { titel: 'Titel', lead: 'Lead.', text: 'Text.' }
        },
        JETZT
      )
    ).rejects.toMatchObject({ status: 422, code: 'FUND_OHNE_GEMEINDE' })
    expect(t.meldungen.zeilen).toHaveLength(0)
    expect(t.funde.finde('f-1')['entscheid']).toBe('offen')
  })

  it('schreibt nichts aus einem geleerten Fund (422) — ausser die Redaktion bringt den Stoff', async () => {
    const leer = { ...leereMaterial(JETZT) }
    const ohne = tisch([zeile(SPERRUNG, leer)])
    await expect(
      uebernehmeFund(
        {
          funde: ohne.funde,
          meldungen: ohne.meldungen,
          regeln: [],
          send: ohne.m.send
        },
        'f-1',
        OHNE_BEITRAG,
        JETZT
      )
    ).rejects.toMatchObject({ status: 422, code: 'FUND_OHNE_MATERIAL' })
    expect(ohne.m.aufrufe).toHaveLength(0)
    expect(ohne.funde.finde('f-1')['entscheid']).toBe('offen')

    // Von Hand: kein Modellaufruf, die Quellenzeile vom Code, der Hinweis des Hauses.
    const hand = tisch([zeile(SPERRUNG, leer)])
    const ergebnis = await uebernehmeFund(
      {
        funde: hand.funde,
        meldungen: hand.meldungen,
        regeln: [],
        send: hand.m.send
      },
      'f-1',
      {
        ergaenzung: null,
        eigene: {
          titel: 'Hauptstrasse gesperrt',
          lead: 'Die Hauptstrasse ist gesperrt.',
          text: 'Die Gemeinde bestätigt die Sperrung.'
        }
      },
      JETZT
    )
    expect(hand.m.aufrufe).toHaveLength(0)
    expect(ergebnis.warnungen).toContain(EIGENE_HINWEIS)
    const artikel = hand.meldungen.zeilen[0] ?? {}
    expect(String(artikel['text'])).toContain(
      'Quelle: Beitrag in der Facebook-Gruppe'
    )
    expect(String(artikel['text'])).toContain('nicht unabhängig bestätigt')
    expect(hand.funde.finde('f-1')).toMatchObject({
      entscheid: 'uebernommen',
      entschieden_am: JETZT
    })
  })

  it('meldet «das Material traegt keine Meldung» als 422 und laesst den Entscheid offen', async () => {
    const t = tisch(
      [zeile(SPERRUNG)],
      [],
      modell({ meldung: () => ({ genuegt: false }) })
    )
    await expect(
      uebernehmeFund(
        { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
        'f-1',
        OHNE_BEITRAG,
        JETZT
      )
    ).rejects.toMatchObject({ status: 422, code: 'MATERIAL_GENUEGT_NICHT' })
    expect(t.meldungen.zeilen).toHaveLength(0)
    expect(t.funde.finde('f-1')['entscheid']).toBe('offen')
  })

  it('verlinkt bei einer geschlossenen Gruppe nur die Gruppe, nie den Beitrag', async () => {
    const t = tisch([
      zeile(GESCHLOSSEN, {
        quelle_url: 'https://www.facebook.com/groups/1000000002'
      })
    ])
    await uebernehmeFund(
      { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
      'f-1',
      OHNE_BEITRAG,
      JETZT
    )
    const artikel = t.meldungen.zeilen[0] ?? {}
    const link = String(t.funde.finde('f-1')['link'])
    expect(link).toContain('/posts/')
    expect(String(artikel['text'])).toContain(
      '<a href="https://www.facebook.com/groups/1000000002">Zur Gruppe</a>'
    )
    expect(JSON.stringify(artikel)).not.toContain(link)
  })
})

describe('lehneFundAb', () => {
  it('leert Kommentare und Bildtexte im selben Schreibzugriff, stempelt und verwirft nur den Entwurf', async () => {
    const t = tisch(
      [zeile(SPERRUNG)],
      [
        { id: 'm-1', buschtelefon_fund: 'f-1', status: 'entwurf' },
        { id: 'm-2', buschtelefon_fund: 'f-9', status: 'entwurf' }
      ]
    )
    expect(
      (t.funde.finde('f-1')['kommentare'] as unknown[]).length
    ).toBeGreaterThan(0)
    const wortlaut = t.funde.finde('f-1')['text']

    await lehneFundAb(
      t,
      'f-1',
      { grund: 'personenbezug', kommentar: 'Nennt eine Privatperson' },
      JETZT
    )

    const nachher = t.funde.finde('f-1')
    expect(nachher).toMatchObject({
      entscheid: 'abgelehnt',
      ablehnungsgrund: 'personenbezug',
      ablehnungskommentar: 'Nennt eine Privatperson',
      entschieden_am: JETZT,
      kommentare: [],
      neue_kommentare: 0
    })
    // The post's own wording stays thirty days as the example.
    expect(nachher['text']).toBe(wortlaut)
    expect(
      (nachher['bilder'] as Array<{ text: unknown }>).every(
        (b) => b.text === null
      )
    ).toBe(true)
    // One write to the find: decision and emptying cannot come apart.
    expect(t.funde.protokoll.filter(([art]) => art === 'update')).toHaveLength(
      1
    )
    expect(t.meldungen.finde('m-1')).toMatchObject({
      status: 'verworfen',
      fehler: 'Fund abgelehnt: personenbezug'
    })
    expect(t.meldungen.finde('m-2')['status']).toBe('entwurf')
  })

  it('verweigert die Ablehnung (409), solange die Meldung in der Gegenpruefung, freigegeben oder publiziert ist', async () => {
    for (const status of ['in_pruefung', 'freigegeben', 'publiziert']) {
      const t = tisch(
        [zeile(SPERRUNG, { entscheid: 'uebernommen' })],
        [
          { id: 'm-0', buschtelefon_fund: 'f-1', status: 'verworfen' },
          { id: 'm-1', buschtelefon_fund: 'f-1', status }
        ]
      )
      const vorher = { ...t.funde.finde('f-1') }
      await expect(
        lehneFundAb(t, 'f-1', { grund: 'veraltet', kommentar: null }, JETZT)
      ).rejects.toMatchObject({ status: 409, code: 'MELDUNG_IN_ARBEIT' })
      // Nothing moved: the article stays, the find keeps its decision and
      // its comments.
      expect(t.meldungen.finde('m-1')['status']).toBe(status)
      expect(t.funde.finde('f-1')).toEqual(vorher)
      expect(
        t.funde.protokoll.filter(([art]) => art === 'update')
      ).toHaveLength(0)
    }
  })

  it('lehnt einen uebernommenen Fund ab, solange seine Meldung ein Entwurf ist — und verwirft ihn', async () => {
    const t = tisch(
      [zeile(SPERRUNG, { entscheid: 'uebernommen' })],
      [
        { id: 'm-0', buschtelefon_fund: 'f-1', status: 'verworfen' },
        { id: 'm-1', buschtelefon_fund: 'f-1', status: 'entwurf' }
      ]
    )
    await lehneFundAb(t, 'f-1', { grund: 'veraltet', kommentar: null }, JETZT)
    expect(t.funde.finde('f-1')['entscheid']).toBe('abgelehnt')
    expect(t.meldungen.finde('m-1')['status']).toBe('verworfen')
  })

  it('lehnt keinen weitergereichten, verfallenen oder schon abgelehnten Fund ab', async () => {
    for (const entscheid of ['weitergereicht', 'verfallen', 'abgelehnt']) {
      const zu = tisch([zeile(SPERRUNG, { entscheid })])
      await expect(
        lehneFundAb(zu, 'f-1', { grund: 'andere', kommentar: null }, JETZT)
      ).rejects.toMatchObject({ status: 409 })
      expect(zu.funde.finde('f-1')['entscheid']).toBe(entscheid)
    }
  })
})

describe('reicheFundWeiter', () => {
  it('legt zuerst die Faehrte an, markiert dann den Fund samt Stempel und verwirft den Entwurf', async () => {
    const t = tisch(
      [zeile(SPERRUNG)],
      [{ id: 'm-1', buschtelefon_fund: 'f-1', status: 'entwurf' }]
    )

    const hinweis = await reicheFundWeiter(
      t,
      'f-1',
      'Bitte bei der IWB nachfragen.',
      JETZT
    )

    const lead = t.hinweise.finde(hinweis)
    expect(lead).toMatchObject({
      buschtelefon_fund: 'f-1',
      gemeinde: 'g-1',
      status: 'offen',
      automatisch: false,
      begruendung: 'Bitte bei der IWB nachfragen.',
      quelltext: null
    })
    expect(String(lead['titel'])).toMatch(/^Beitrag aus Facebook-Gruppe «/)
    // No wording, no image text, no first name, no link: the Chefredaktion
    // reads the find live through `buschtelefon_fund`.
    const fund = t.funde.finde('f-1')
    const alsText = JSON.stringify(lead)
    expect(alsText).not.toContain(String(fund['link']))
    const erste = String(fund['text']).split(/\s+/).slice(0, 4).join(' ')
    expect(erste.length).toBeGreaterThan(5)
    expect(alsText).not.toContain(erste)
    for (const k of (fund['kommentare'] ?? []) as Array<{
      text: string | null
      autor_vorname: string | null
    }>) {
      if (k.text !== null) expect(alsText).not.toContain(k.text)
      if (k.autor_vorname !== null)
        expect(alsText).not.toContain(k.autor_vorname)
    }
    expect(lead['regel']).toBeUndefined()
    expect(t.funde.finde('f-1')).toMatchObject({
      entscheid: 'weitergereicht',
      entschieden_am: JETZT
    })
    expect(t.meldungen.finde('m-1')['status']).toBe('verworfen')
  })

  it('kennzeichnet eine Weitergabe nach Regel als automatisch, mit der Regel', async () => {
    const t = tisch([zeile(SPERRUNG, { gemeinde: null })])
    const hinweis = await reicheFundWeiter(t, 'f-1', null, JETZT, {
      regel: 'r-7'
    })
    expect(t.hinweise.finde(hinweis)).toMatchObject({
      automatisch: true,
      regel: 'r-7',
      // A find without a municipality can still be handed up.
      gemeinde: null,
      begruendung: 'Betrifft viele im Dorf.'
    })
  })

  it('liest fuer die Faehrte nichts vom Material', () => {
    for (const feld of [
      'text',
      'bilder',
      'geteilt',
      'kommentare',
      'verlinkt',
      'link',
      'autor_vorname',
      'autor_name'
    ])
      expect(WEITERREICH_FELDER).not.toContain(feld)
  })

  it('reicht keinen offenen Fund weiter, dessen Meldung ueber den Entwurf hinaus ist (409)', async () => {
    for (const status of ['in_pruefung', 'freigegeben', 'publiziert']) {
      const t = tisch(
        [zeile(SPERRUNG)],
        [{ id: 'm-1', buschtelefon_fund: 'f-1', status }]
      )
      await expect(
        reicheFundWeiter(t, 'f-1', null, JETZT)
      ).rejects.toMatchObject({ status: 409, code: 'MELDUNG_IN_ARBEIT' })
      expect(t.hinweise.zeilen).toHaveLength(0)
      expect(t.funde.finde('f-1')['entscheid']).toBe('offen')
      expect(t.meldungen.finde('m-1')['status']).toBe(status)
    }
  })

  it('reicht nur einen offenen Fund weiter (409) und legt dann keine Faehrte an', async () => {
    for (const entscheid of ['uebernommen', 'abgelehnt', 'weitergereicht']) {
      const t = tisch([zeile(SPERRUNG, { entscheid })])
      await expect(
        reicheFundWeiter(t, 'f-1', null, JETZT)
      ).rejects.toMatchObject({ status: 409 })
      expect(t.hinweise.zeilen).toHaveLength(0)
    }
  })
})

describe('ordneGemeindeZu', () => {
  it('ordnet einen offenen Fund einer bespielten Gemeinde zu', async () => {
    const t = tisch([zeile(SPERRUNG, { gemeinde: null })])
    await ordneGemeindeZu(t, 'f-1', 'g-2')
    expect(t.funde.finde('f-1')['gemeinde']).toBe('g-2')
  })

  it('verweigert eine unbekannte oder nicht bespielte Gemeinde (400)', async () => {
    const t = tisch([zeile(SPERRUNG, { gemeinde: null })])
    for (const gemeinde of ['g-3', 'g-99']) {
      await expect(ordneGemeindeZu(t, 'f-1', gemeinde)).rejects.toMatchObject({
        status: 400
      })
    }
    expect(t.funde.finde('f-1')['gemeinde']).toBeNull()
  })

  it('aendert nichts mehr nach dem Entscheid oder sobald ein Artikel dazu besteht (409)', async () => {
    const entschieden = tisch([zeile(SPERRUNG, { entscheid: 'abgelehnt' })])
    await expect(
      ordneGemeindeZu(entschieden, 'f-1', 'g-2')
    ).rejects.toMatchObject({ status: 409 })

    const mitArtikel = tisch(
      [zeile(SPERRUNG)],
      [{ id: 'm-1', buschtelefon_fund: 'f-1', status: 'entwurf' }]
    )
    await expect(
      ordneGemeindeZu(mitArtikel, 'f-1', 'g-2')
    ).rejects.toMatchObject({ status: 409, code: 'ALREADY_WRITTEN' })
    expect(mitArtikel.funde.finde('f-1')['gemeinde']).toBe('g-1')
  })
})

describe('gibFundZurueck', () => {
  it('oeffnet einen Fund mit Material wieder und stempelt den Tag der Rueckgabe', async () => {
    const t = tisch([
      zeile(SPERRUNG, {
        entscheid: 'weitergereicht',
        entschieden_am: '2026-11-03T10:00:00.000Z'
      })
    ])
    expect(await gibFundZurueck(t.funde, 'f-1', JETZT)).toBe('offen')
    // Retention counts the open days from the later of release and this.
    expect(t.funde.finde('f-1')).toMatchObject({
      entscheid: 'offen',
      entschieden_am: JETZT
    })
  })

  it('laesst einen Fund verfallen, dessen Material geleert oder dessen Beitrag entfernt ist', async () => {
    const geleert = tisch([
      zeile(SPERRUNG, {
        entscheid: 'weitergereicht',
        entschieden_am: '2026-08-01T10:00:00.000Z',
        ...leereMaterial('2026-11-01T12:00:00.000Z')
      })
    ])
    expect(await gibFundZurueck(geleert.funde, 'f-1', JETZT)).toBe('verfallen')
    expect(geleert.funde.finde('f-1')).toMatchObject({
      entscheid: 'verfallen',
      entschieden_am: '2026-08-01T10:00:00.000Z'
    })

    const entfernt = tisch([
      zeile(SPERRUNG, { entscheid: 'weitergereicht', status: 'entfernt' })
    ])
    expect(await gibFundZurueck(entfernt.funde, 'f-1', JETZT)).toBe('verfallen')
    expect(entfernt.funde.finde('f-1')['entscheid']).toBe('verfallen')
  })
})

describe('markiereUebernommen', () => {
  it('setzt den Entscheid, wenn der Entwurf des Laufs weitergeht — und nur auf einer offenen Zeile', async () => {
    const offen = tisch([zeile(SPERRUNG)])
    expect(await markiereUebernommen(offen.funde, 'f-1', JETZT)).toBe(true)
    expect(offen.funde.finde('f-1')).toMatchObject({
      entscheid: 'uebernommen',
      entschieden_am: JETZT
    })

    const schon = tisch([
      zeile(SPERRUNG, {
        entscheid: 'uebernommen',
        entschieden_am: '2026-11-10T09:00:00.000Z'
      })
    ])
    expect(await markiereUebernommen(schon.funde, 'f-1', JETZT)).toBe(false)
    expect(schon.funde.finde('f-1')['entschieden_am']).toBe(
      '2026-11-10T09:00:00.000Z'
    )
  })

  it('wirft nie — der Statuswechsel der Meldung ist laengst geschrieben', async () => {
    const t = tisch([])
    const warn = vi.fn()
    expect(await markiereUebernommen(t.funde, 'f-404', JETZT, { warn })).toBe(
      false
    )
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('ueberarbeiteFundMeldung', () => {
  it('liest den Fund frisch und setzt die Quellenzeile nach der Ueberarbeitung wieder an', async () => {
    const t = tisch(
      [zeile(SPERRUNG)],
      [
        {
          id: 'm-1',
          buschtelefon_fund: 'f-1',
          status: 'entwurf',
          titel: 'Alt',
          lead: 'Alt.',
          text: 'Alter Text.\n\nQuelle: Beitrag in der Facebook-Gruppe «X» – nicht unabhängig bestätigt.'
        }
      ]
    )
    await ueberarbeiteFundMeldung(
      { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
      { id: 'm-1', titel: 'Alt', lead: 'Alt.', text: 'Alter Text.' },
      'f-1',
      'Kürzer bitte.',
      null
    )
    const text = String(t.meldungen.finde('m-1')['text'])
    expect(text.match(/Quelle: /g)).toHaveLength(1)
    expect(t.meldungen.finde('m-1')['verarbeitung']).toBe('idle')
    expect(t.m.aufrufe[0]?.prompt).toContain('Kürzer bitte.')
  })

  it('sagt es, wenn der Wortlaut inzwischen geleert ist und keine Angaben der Redaktion tragen', async () => {
    const t = tisch([zeile(SPERRUNG, leereMaterial(JETZT))])
    await expect(
      ueberarbeiteFundMeldung(
        { funde: t.funde, meldungen: t.meldungen, regeln: [], send: t.m.send },
        { id: 'm-1', titel: 'Alt', lead: 'Alt.', text: 'Alter Text.' },
        'f-1',
        'Kürzer bitte.',
        null
      )
    ).rejects.toMatchObject({ code: 'FUND_OHNE_MATERIAL' })
    expect(t.m.aufrufe).toHaveLength(0)
  })
})

describe('laufAntwort', () => {
  it('sagt, ob die Tuer eingerichtet ist — und sonst, welche Variable fehlt, nie einen Wert', () => {
    expect(laufAntwort(leererLauf(), ZUGANG_ENV)).toEqual({
      laeuft: false,
      gestartet_um: null,
      beendet_um: null,
      ergebnis: null,
      fehler: null,
      eingerichtet: true,
      fehlend: []
    })
    const ohne = laufAntwort(leererLauf(), {
      BUSCHTELEFON_CF_CLIENT_ID: 'kennung',
      BUSCHTELEFON_CF_CLIENT_SECRET: 'sehr-geheim'
    } as unknown as NodeJS.ProcessEnv)
    expect(ohne.eingerichtet).toBe(false)
    expect(ohne.fehlend).toEqual(['BUSCHTELEFON_SCHLUESSEL'])
    expect(JSON.stringify(ohne)).not.toContain('sehr-geheim')
  })
})

describe('verdrahteBuschtelefon', () => {
  type Handler = (
    req: Record<string, unknown>,
    res: Antwort,
    next: (fehler?: unknown) => void
  ) => unknown
  interface Antwort {
    code: number
    koerper: unknown
    status(code: number): Antwort
    json(koerper: unknown): Antwort
  }

  function antwort(): Antwort {
    const a: Antwort = {
      code: 200,
      koerper: undefined,
      status(code) {
        a.code = code
        return a
      },
      json(koerper) {
        a.koerper = koerper
        return a
      }
    }
    return a
  }

  class NichtAngemeldet extends Error {
    status = 401
  }

  function aufbau(
    t = tisch([zeile(SPERRUNG)]),
    holeAb: () => Promise<unknown> = async () => ({ status: 'ok', neu: 2 }),
    laeuftAnderswo: () => boolean = () => false
  ) {
    const routen = new Map<string, Handler>()
    const router = {
      get: (pfad: string, h: Handler) => void routen.set(`GET ${pfad}`, h),
      post: (pfad: string, h: Handler) => void routen.set(`POST ${pfad}`, h)
    }
    const gelernt: unknown[] = []
    const protokoll: unknown[] = []
    const sammlungen: Record<string, unknown> = {
      buschtelefon_funde: t.funde,
      meldungen: t.meldungen,
      recherchehinweise: t.hinweise,
      gemeinden: t.gemeinden
    }
    const optionen: Array<[string, unknown]> = []
    let abgeholt = 0
    const umgebung = {
      services: {
        ItemsService: function (
          this: unknown,
          name: string,
          o: unknown
        ): unknown {
          optionen.push([name, o])
          return sammlungen[name]
        }
      },
      getSchema: async () => ({}),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: (e: unknown, m?: string) => void protokoll.push([e, m])
      },
      holeAb: () => {
        abgeholt += 1
        return holeAb()
      },
      pruefeId: (wert: unknown) => {
        if (typeof wert !== 'string' || wert === '') throw new UngueltigeId()
        return wert
      },
      beitragAus: (req: { body?: unknown }) =>
        leseBeitrag(req.body).beitrag ?? OHNE_BEITRAG,
      lerne: (signal: unknown) => void gelernt.push(signal),
      textregeln: async () => [],
      uebersetze: (fehler: unknown) => fehler,
      NichtAngemeldet,
      laeuftAnderswo
    } as unknown as BuschtelefonUmgebung
    verdrahteBuschtelefon(router as never, umgebung)

    async function rufe(
      route: string,
      req: Record<string, unknown> = {}
    ): Promise<{ antwort: Antwort; fehler: unknown }> {
      const handler = routen.get(route)
      if (handler === undefined) throw new Error(`keine Route ${route}`)
      const a = antwort()
      let fehler: unknown
      await handler(
        { accountability: { user: 'u-1' }, params: {}, body: {}, ...req },
        a,
        (f) => {
          fehler = f
        }
      )
      return { antwort: a, fehler }
    }
    return {
      routen,
      rufe,
      gelernt,
      protokoll,
      optionen,
      t,
      abgeholt: () => abgeholt
    }
  }

  it('registriert genau die Routen, die der Arbeitsplatz ruft', () => {
    expect([...aufbau().routen.keys()].sort()).toEqual([
      'GET /buschtelefon/lauf',
      'POST /buschtelefon/:id/ablehnen',
      'POST /buschtelefon/:id/gemeinde',
      'POST /buschtelefon/:id/meldung',
      'POST /buschtelefon/:id/weiterreichen',
      'POST /buschtelefon/pruefen'
    ])
  })

  it('laesst niemanden ohne Anmeldung herein — keine der Routen', async () => {
    const a = aufbau()
    for (const route of a.routen.keys()) {
      const { fehler, antwort: res } = await a.rufe(route, {
        accountability: undefined,
        params: { id: 'f-1' },
        body: { grund: 'andere', gemeinde: 'g-2' }
      })
      expect(fehler).toBeInstanceOf(NichtAngemeldet)
      expect(res.koerper).toBeUndefined()
    }
    expect(a.t.funde.finde('f-1')['entscheid']).toBe('offen')
    expect(a.gelernt).toHaveLength(0)
  })

  it('startet den Lauf abgeloest (202), nur einen zur Zeit (409), und zeigt sein Ergebnis im Umschlag', async () => {
    let fertig: (wert: unknown) => void = () => undefined
    const a = aufbau(
      undefined,
      () =>
        new Promise((resolve) => {
          fertig = resolve
        })
    )

    const erster = await a.rufe('POST /buschtelefon/pruefen')
    expect(erster.antwort.code).toBe(202)
    const zweiter = await a.rufe('POST /buschtelefon/pruefen')
    expect(zweiter.fehler).toMatchObject({ status: 409 })

    const waehrend = (await a.rufe('GET /buschtelefon/lauf')).antwort
      .koerper as { data: Record<string, unknown> }
    expect(waehrend.data['laeuft']).toBe(true)
    expect(Array.isArray(waehrend.data['fehlend'])).toBe(true)

    // The detached chain starts on a microtask; give it one turn.
    await new Promise((r) => setTimeout(r, 0))
    fertig({ status: 'ok', neu: 2 })
    await new Promise((r) => setTimeout(r, 0))

    const danach = (await a.rufe('GET /buschtelefon/lauf')).antwort.koerper as {
      data: Record<string, unknown>
    }
    expect(danach.data).toMatchObject({
      laeuft: false,
      ergebnis: { status: 'ok', neu: 2 },
      fehler: null
    })
    expect(danach.data['beendet_um']).not.toBeNull()
  })

  it('haelt einen gescheiterten Lauf fest, statt den Prozess mitzunehmen — in neutralen Worten', async () => {
    const a = aufbau(undefined, async () => {
      throw new Error(
        'Claude did not return parseable JSON. Raw answer: {"titel": "Sandra Muster sucht'
      )
    })
    await a.rufe('POST /buschtelefon/pruefen')
    await new Promise((r) => setTimeout(r, 0))
    const danach = (await a.rufe('GET /buschtelefon/lauf')).antwort.koerper as {
      data: Record<string, unknown>
    }
    expect(danach.data).toMatchObject({
      laeuft: false,
      fehler: LAUF_ABGEBROCHEN
    })
    // Neither the answer nor the log carries the model's words.
    expect(JSON.stringify(danach)).not.toContain('Sandra')
    expect(JSON.stringify(a.protokoll)).not.toContain('Sandra')
    expect(a.protokoll).toHaveLength(1)
  })

  it('zeigt einen Fehler der Tuer in ihren eigenen Worten — die enthalten nie einen Koerper', () => {
    const tuer = new BuschtelefonFehler(
      'netz',
      'Das Buschtelefon antwortet nicht.'
    )
    expect(laufFehlerText(tuer)).toBe('Das Buschtelefon antwortet nicht.')
    expect(laufFehlerText(new Error('Raw answer: …'))).toBe(LAUF_ABGEBROCHEN)
    expect(laufFehlerText('Zeichenkette')).toBe(LAUF_ABGEBROCHEN)
  })

  it('startet keinen zweiten Lauf, solange der des Flows laeuft (409) — und sagt «laeuft»', async () => {
    let flowLaeuft = true
    const a = aufbau(undefined, undefined, () => flowLaeuft)

    const status = (await a.rufe('GET /buschtelefon/lauf')).antwort.koerper as {
      data: Record<string, unknown>
    }
    expect(status.data['laeuft']).toBe(true)

    const versuch = await a.rufe('POST /buschtelefon/pruefen')
    expect(versuch.fehler).toMatchObject({
      status: 409,
      code: 'RUN_IN_PROGRESS'
    })
    expect(a.abgeholt()).toBe(0)

    flowLaeuft = false
    const spaeter = await a.rufe('POST /buschtelefon/pruefen')
    expect(spaeter.antwort.code).toBe(202)
    await new Promise((r) => setTimeout(r, 0))
    expect(a.abgeholt()).toBe(1)
  })

  it('lehnt ab, lernt daraus und arbeitet mit den Rechten der Person', async () => {
    const a = aufbau()
    const { antwort: res, fehler } = await a.rufe(
      'POST /buschtelefon/:id/ablehnen',
      {
        params: { id: 'f-1' },
        body: { grund: 'unbestaetigt', kommentar: 'Nur ein Gerücht' }
      }
    )
    expect(fehler).toBeUndefined()
    expect(res.koerper).toEqual({
      data: { fund: 'f-1', entscheid: 'abgelehnt' }
    })
    expect(a.gelernt).toEqual([
      {
        tisch: 'buschtelefon',
        art: 'entscheid',
        zeileId: 'f-1',
        entscheid: 'abgelehnt',
        grund: 'unbestaetigt',
        kommentar: 'Nur ein Gerücht'
      }
    ])
    for (const [name, o] of a.optionen)
      if (name !== 'recherchehinweise')
        expect(o).toMatchObject({ accountability: { user: 'u-1' } })

    const falsch = await a.rufe('POST /buschtelefon/:id/ablehnen', {
      params: { id: 'f-1' },
      body: { grund: 'nur_erwaehnt' }
    })
    expect(falsch.fehler).toMatchObject({ status: 400 })
  })

  it('reicht weiter und lernt die Begruendung; ordnet die Gemeinde zu, ohne zu lernen', async () => {
    const a = aufbau(tisch([zeile(SPERRUNG, { gemeinde: null })]))
    const zuordnung = await a.rufe('POST /buschtelefon/:id/gemeinde', {
      params: { id: 'f-1' },
      body: { gemeinde: 'a1b2c3d4-0000-4000-8000-000000000001' }
    })
    // A well-formed id of a municipality nobody covers.
    expect(zuordnung.fehler).toMatchObject({ status: 400 })
    expect(a.gelernt).toHaveLength(0)

    const weiter = await a.rufe('POST /buschtelefon/:id/weiterreichen', {
      params: { id: 'f-1' },
      body: { begruendung: 'Nachfragen' }
    })
    expect(weiter.fehler).toBeUndefined()
    expect(weiter.antwort.koerper).toMatchObject({
      data: { hinweis: expect.any(String) }
    })
    // The lead is created by the system — no revision of it — while the
    // find is read with the person's own rights first.
    const hinweisOptionen = a.optionen.filter(
      ([name]) => name === 'recherchehinweise'
    )
    expect(hinweisOptionen.length).toBeGreaterThan(0)
    for (const [, o] of hinweisOptionen)
      expect(o as Record<string, unknown>).not.toHaveProperty('accountability')
    for (const [, o] of a.optionen.filter(
      ([name]) => name === 'buschtelefon_funde'
    ))
      expect(o).toMatchObject({ accountability: { user: 'u-1' } })
    expect(a.t.hinweise.zeilen[0]?.['quelltext']).toBeNull()
    expect(a.gelernt).toEqual([
      {
        tisch: 'buschtelefon',
        art: 'entscheid',
        zeileId: 'f-1',
        entscheid: 'weitergereicht',
        grund: null,
        kommentar: 'Nachfragen'
      }
    ])
  })

  it('gibt bei der Meldung die eigenen 4xx weiter und verbirgt alles andere hinter der 502', async () => {
    const ohneGemeinde = aufbau(tisch([zeile(SPERRUNG, { gemeinde: null })]))
    const absage = await ohneGemeinde.rufe('POST /buschtelefon/:id/meldung', {
      params: { id: 'f-1' }
    })
    expect(absage.fehler).toMatchObject({
      status: 422,
      code: 'FUND_OHNE_GEMEINDE'
    })
    expect(ohneGemeinde.gelernt).toHaveLength(0)

    // A provider error may carry the prompt — a private person's post.
    // Written by hand, so no model is asked; the write itself fails.
    const kaputt = aufbau(tisch([zeile(SPERRUNG)]))
    kaputt.t.meldungen.createOne = async () => {
      throw new Error('PROMPT: Weiss jemand, warum die Hauptstrasse …')
    }
    const fehlschlag = await kaputt.rufe('POST /buschtelefon/:id/meldung', {
      params: { id: 'f-1' },
      body: {
        eigene: { titel: 'Titel', lead: 'Lead.', text: 'Text.' }
      }
    })
    expect(fehlschlag.fehler).toMatchObject({
      status: 502,
      code: 'REQUEST_FAILED'
    })
    expect(JSON.stringify(fehlschlag.fehler)).not.toContain('Hauptstrasse')
    expect(String((fehlschlag.fehler as Error).message)).not.toContain(
      'Hauptstrasse'
    )
    expect(kaputt.protokoll).toHaveLength(1)
    expect(JSON.stringify(kaputt.protokoll)).not.toContain('Hauptstrasse')
  })

  it('entscheidet nach dem Typ, nicht nach dem Status: ein 4xx des Anbieters ist kein Fehler der Anfrage', async () => {
    // The Anthropic SDK's APIError carries its own 404/429 — a retired model
    // id must not read «Fund nicht gefunden», and its body must not go out.
    class APIError extends Error {
      status = 404
      error = { type: 'not_found_error', message: 'PROMPT: Sandra Muster …' }
      headers = { 'request-id': 'req_1' }
    }
    const a = aufbau(tisch([zeile(SPERRUNG)]))
    a.t.meldungen.createOne = async () => {
      throw new APIError('404 {"type":"error","error":"PROMPT: Sandra Muster"}')
    }
    const { fehler } = await a.rufe('POST /buschtelefon/:id/meldung', {
      params: { id: 'f-1' },
      body: { eigene: { titel: 'Titel', lead: 'Lead.', text: 'Text.' } }
    })
    expect(fehler).toMatchObject({ status: 502, code: 'REQUEST_FAILED' })
    expect(JSON.stringify(a.protokoll)).not.toContain('Sandra')
    expect(a.protokoll[0]).toEqual([
      { name: 'Error', code: null, status: 404 },
      'redaktion: Buschtelefon-Meldung fehlgeschlagen'
    ])

    // A Directus error — here the 403 of an unreadable find — is the house's
    // own and goes out through `uebersetze`, unlogged.
    const fremd = aufbau(tisch([]))
    const verboten = await fremd.rufe('POST /buschtelefon/:id/ablehnen', {
      params: { id: 'f-404' },
      body: { grund: 'andere' }
    })
    expect(verboten.fehler).toBeInstanceOf(Verboten)
    expect(fremd.protokoll).toHaveLength(0)
  })

  it('verbirgt auch beim Ablehnen und Weiterreichen jeden fremden Fehler hinter der 502', async () => {
    const a = aufbau(tisch([zeile(SPERRUNG)]))
    a.t.funde.updateOne = async () => {
      throw new Error('duplicate key value violates … (Sandra)')
    }
    for (const [route, body] of [
      ['POST /buschtelefon/:id/ablehnen', { grund: 'andere' }],
      ['POST /buschtelefon/:id/weiterreichen', {}]
    ] as const) {
      const { fehler } = await a.rufe(route, { params: { id: 'f-1' }, body })
      expect(fehler).toMatchObject({ status: 502, code: 'REQUEST_FAILED' })
    }
    expect(a.protokoll).toHaveLength(2)
    expect(JSON.stringify(a.protokoll)).not.toContain('Sandra')
  })
})

describe('istEigeneAntwort / fehlerKennung', () => {
  it('erkennt die Antworten des Hauses am Typ und loggt von allem nur die Klasse', () => {
    expect(istEigeneAntwort(new Verboten())).toBe(true)
    expect(
      istEigeneAntwort(Object.assign(new Error('x'), { status: 404 }))
    ).toBe(false)
    expect(istEigeneAntwort(null)).toBe(false)
    expect(
      fehlerKennung(
        Object.assign(new Error('Raw answer: Sandra'), {
          code: 'X',
          status: 429
        })
      )
    ).toEqual({ name: 'Error', code: 'X', status: 429 })
    expect(fehlerKennung('Zeichenkette')).toEqual({
      name: null,
      code: null,
      status: null
    })
  })
})
