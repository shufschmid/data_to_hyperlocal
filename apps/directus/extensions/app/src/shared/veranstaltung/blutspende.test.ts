import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KEINE_TERMINE_HINWEIS,
  leseUebersicht,
  type Leser
} from '../gemeindeseite'
import { heuteAus } from '../gemeindeseite/datum'
import {
  detailFamilie,
  erkennePlattform,
  familieOhneBeschrieb,
  listenArt,
  nurEckdatenVorlage,
  ueberDatentuer
} from '../gemeindeseite/erkennung'
import {
  leereBlutspendeListe,
  parseBlutspendeTermine,
  parseListe,
  plzOrt
} from '../gemeindeseite/liste'
import { terminKandidaten } from '../gemeindeseite/auswahl'
import { berechneAnker } from './anker'
import { gruppiereAnlaesse } from './anlass'
import { parseAnlassDetail, parseBlutspendeAnlass } from './detail'

// Gemessen am 30. September 2026: die nationale Seite blutspende.ch hat keine
// API, aber eine Suche nach POSTLEITZAHL mit Radius 0 — 4147 ist nur Aesch BL,
// waehrend die Suche nach dem Namen 8904/8412/6287 Aesch und 4556/3703 Aeschi
// zurueckgibt. Die drei Fixtures sind die Liste fuer 4147, die leere Liste fuer
// 4103 (Bottmingen) und die Seite des Termins vom 26. Januar 2027.

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const LISTE =
  'https://www.blutspende.ch/de/blutspendetermine/terminliste?location_search_form%5Bradius%5D=0&location_search_form%5Bterm%5D=4147'
const TERMIN =
  'https://www.blutspende.ch/de/blutspendetermine/termin/pdja37vslwxsilljm_xuta'
const HEUTE = heuteAus('2026-09-30')

/** Ein Leser, der eine Seite aus dem Speicher reicht — keine Anfrage, kein Netz. */
const leserFuer = (html: string): Leser =>
  ({
    liesSeite: async (url: string) => ({
      art: 'html' as const,
      html,
      url,
      transport: 'direkt' as const
    }),
    liesJson: async () => null,
    liesPdf: async () => {
      throw new Error('kein PDF')
    },
    protokoll: () => ({ anfragen: 1, gebremst: 0, ueberCrawler: [] })
  }) as unknown as Leser

describe('Erkennung', () => {
  it('erkennt die Terminliste an ihrem Container und Suchformular, auch leer', () => {
    expect(erkennePlattform(fixture('blutspende-liste.html'))).toBe(
      'blutspende_termine'
    )
    expect(erkennePlattform(fixture('blutspende-leer.html'))).toBe(
      'blutspende_termine'
    )
    // Die Seite eines Termins ist keine Liste.
    expect(erkennePlattform(fixture('blutspende-termin.html'))).toBeNull()
    expect(listenArt('blutspende_termine')).toBe('termin')
    expect(detailFamilie('blutspende_termine')).toBe('blutspende')
    expect(ueberDatentuer('blutspende_termine')).toBe(false)
  })

  it('ist eine Eckdaten-Vorlage — und die anderen nicht', () => {
    expect(nurEckdatenVorlage('blutspende_termine')).toBe(true)
    expect(nurEckdatenVorlage('iweb_termine')).toBe(false)
    expect(nurEckdatenVorlage(null)).toBe(false)
    expect(nurEckdatenVorlage(undefined)).toBe(false)
    expect(familieOhneBeschrieb('blutspende')).toBe(true)
    expect(familieOhneBeschrieb('drupal')).toBe(false)
  })
})

describe('die Liste einer Postleitzahl', () => {
  it('liest je Termin Tag, Art, Lokal, Zeit, Ort und die Seite des Termins', () => {
    const liste = parseListe(
      fixture('blutspende-liste.html'),
      'blutspende_termine',
      LISTE,
      HEUTE
    )
    expect(liste).toHaveLength(2)
    expect(liste[0]).toMatchObject({
      url: TERMIN,
      titel: 'Blutspende in Aesch',
      kategorie: 'Blutspende',
      veranstaltungAm: '2027-01-26',
      veranstaltungBis: null,
      zeit: '17:00–20:00',
      lokalitaet: 'Röm. Kath. Pfarrheim',
      ort: 'Aesch',
      veranstalter: null,
      serie: 'pdja37vslwxsilljm_xuta',
      datum: null,
      abgesagt: false
    })
    expect(liste[1]).toMatchObject({
      veranstaltungAm: '2027-09-07',
      serie: '5nfa1t4iagectomjbblrua'
    })
  })

  it('trennt Postleitzahl und Ort — und nur so, nie am Namen', () => {
    expect(plzOrt('4147 Aesch')).toEqual({ plz: '4147', ort: 'Aesch' })
    expect(plzOrt(' 4125 Riehen ')).toEqual({ plz: '4125', ort: 'Riehen' })
    expect(plzOrt('Aesch')).toBeNull()
    expect(plzOrt('')).toBeNull()
  })
})

describe('jeder Termin ist ein eigener Anlass', () => {
  it('legt keine Serie zusammen — die Kennung der Seite ist der Schluessel', () => {
    const liste = parseBlutspendeTermine(
      fixture('blutspende-liste.html'),
      LISTE,
      HEUTE
    )
    const gruppen = gruppiereAnlaesse(liste)
    expect(gruppen).toHaveLength(2)
    expect(gruppen.map((g) => g.schluessel)).toEqual([
      'serie:pdja37vslwxsilljm_xuta',
      'serie:5nfa1t4iagectomjbblrua'
    ])
    expect(gruppen[0]?.termine).toEqual(['2027-01-26'])
    expect(gruppen[0]?.url).toBe(TERMIN)
    const befund = berechneAnker(
      {
        titel: 'Blutspende in Aesch',
        termine: ['2027-01-26'],
        von: '2027-01-26',
        bis: null,
        spanne: false,
        text: '',
        kategorie: 'Blutspende',
        teaser: null,
        abgesagt: false,
        serieSeit: null
      },
      '2026-11-30',
      { erstlauf: true, bekannt: false },
      heuteAus('2026-11-30')
    )
    expect(befund.anker).toBe('einmalig')
    expect(befund.ankerAm).toBe('2027-01-26')
  })

  it('das Fenster laeuft vorwaerts: am 30.09.2026 ist noch kein Aescher Termin drin', () => {
    const liste = parseBlutspendeTermine(
      fixture('blutspende-liste.html'),
      LISTE,
      HEUTE
    )
    expect(terminKandidaten(liste, '2026-09-30').drin).toHaveLength(0)
    expect(terminKandidaten(liste, '2026-11-30').drin).toHaveLength(1)
  })
})

// Bottmingen (4103) hat keinen Termin: die Seite sagt es selbst, und das ist
// eine Antwort, kein Fehler — aber eine, die auf der Zeile steht.
describe('eine leere Suche', () => {
  it('ist nur dann leer, wenn die Seite «keine Treffer» sagt', () => {
    const leer = fixture('blutspende-leer.html')
    expect(leereBlutspendeListe(leer)).toBe(true)
    expect(parseBlutspendeTermine(leer, LISTE, HEUTE)).toEqual([])
    expect(leereBlutspendeListe(fixture('blutspende-liste.html'))).toBe(false)
    expect(() =>
      parseBlutspendeTermine(
        '<div id="mobile_venue_appointments"><ul class="no-bullets"></ul></div>',
        LISTE,
        HEUTE
      )
    ).toThrow(/Seitenaufbau/)
  })

  it('geht durch leseUebersicht als gueltige, deklarierte Antwort', async () => {
    const leer = await leseUebersicht(
      leserFuer(fixture('blutspende-leer.html')),
      LISTE,
      HEUTE,
      'termin'
    )
    expect(leer.plattform).toBe('blutspende_termine')
    expect(leer.eintraege).toEqual([])
    expect(leer.luecken).toEqual([KEINE_TERMINE_HINWEIS])
    const voll = await leseUebersicht(
      leserFuer(fixture('blutspende-liste.html')),
      LISTE,
      HEUTE,
      'termin'
    )
    expect(voll.eintraege).toHaveLength(2)
    expect(voll.luecken).toBeUndefined()
  })
})

describe('die Seite eines Termins', () => {
  it('liest die Eckdaten als Felder und keinen Beschrieb', () => {
    const detail = parseAnlassDetail(
      fixture('blutspende-termin.html'),
      'blutspende',
      TERMIN,
      HEUTE
    )
    expect(detail).toMatchObject({
      titel: 'Blutspende in Aesch',
      zeit: '17:00–20:00',
      lokalitaet: 'Röm. Kath. Pfarrheim',
      adresse: 'In den Saalbünten 1',
      ort: 'Aesch',
      veranstalter: 'Blutspende SRK Nordwestschweiz (BS/BL)',
      kategorie: 'Blutspende',
      preis: null,
      anmeldung: 'Termin online reservierbar',
      beschreibung: '',
      dokumente: [],
      weitereTermine: ['2027-01-26'],
      traktandenLink: null,
      // Nie der generische Leser: der machte Navigation, Fusszeile und das
      // Erinnerungsformular zum Beschrieb — und daraus wuerde ein Artikel.
      verfahren: 'blutspende'
    })
  })

  it('wirft, wo die Seite die Liste ist oder den Block nicht traegt', () => {
    expect(() =>
      parseBlutspendeAnlass(fixture('blutspende-liste.html'), TERMIN, HEUTE)
    ).toThrow(/Terminliste/)
    expect(() =>
      parseBlutspendeAnlass(
        '<html><body><p>Nichts</p></body></html>',
        TERMIN,
        HEUTE
      )
    ).toThrow(/Termin-Block/)
  })
})
