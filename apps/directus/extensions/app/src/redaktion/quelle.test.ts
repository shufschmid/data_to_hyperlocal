import { describe, expect, it } from 'vitest'
import {
  AMT,
  quellenlink,
  quellenlinkWarnung,
  repariereQuellenlink
} from './quelle'

const WEBARTIKEL =
  'https://www.baselland.ch/politik-und-behorden/direktionen/finanz-und-kirchendirektion/daten-statistik/abteilung-statistik/publikationen-und-statistiken/bau-und-boden/webartikel-vom-21-08-2026-bau-und-wohnbaustatistik-2025'

describe('quellenlink', () => {
  it('nimmt den Webartikel des Amts, wenn die Agenda einen verlinkt', () => {
    const link = quellenlink({
      ankuendigungLink: WEBARTIKEL,
      quelleTyp: 'ods',
      externeId: '10230'
    })
    expect(link).toEqual({
      url: WEBARTIKEL,
      bezeichnung: AMT,
      webartikel: true
    })
  })

  it('faellt auf die konkrete Datendatei zurueck', () => {
    expect(
      quellenlink({
        ankuendigungLink: null,
        quelleTyp: 'ods',
        externeId: '10230'
      })?.url
    ).toBe('https://data.bl.ch/explore/dataset/10230/')
    expect(
      quellenlink({
        ankuendigungLink: null,
        quelleTyp: 'statbl',
        externeId: '9_1'
      })?.url
    ).toBe('https://statistik.bl.ch/web_portal/9_1')
  })

  // Ein Agenda-Link auf die Anmeldeseite oder auf das Portal ist kein Artikel.
  it('haelt fremde Adressen nicht fuer einen Webartikel', () => {
    expect(
      quellenlink({
        ankuendigungLink: 'https://statistik.bl.ch/web_portal/9_1',
        quelleTyp: 'ods',
        externeId: '10230'
      })?.url
    ).toBe('https://data.bl.ch/explore/dataset/10230/')
  })

  // Lieber gar kein Link als ein erfundener.
  it('sagt nichts, wenn nichts belegt ist', () => {
    expect(
      quellenlink({ ankuendigungLink: null, quelleTyp: 'ods', externeId: '' })
    ).toBeNull()
    expect(
      quellenlink({
        ankuendigungLink: null,
        quelleTyp: 'irgendwas',
        externeId: '5'
      })
    ).toBeNull()
  })
})

describe('quellenlinkWarnung', () => {
  const link = quellenlink({
    ankuendigungLink: null,
    quelleTyp: 'ods',
    externeId: '10230'
  })
  const gut = `In Pratteln entstanden 22 Wohnungen, wie das <a href="https://data.bl.ch/explore/dataset/10230/">Statistische Amt meldet</a>.`

  it('ist zufrieden mit genau der belegten Adresse', () => {
    expect(quellenlinkWarnung(gut, link)).toBeNull()
  })

  it('meldet den fehlenden Link', () => {
    expect(
      quellenlinkWarnung('In Pratteln entstanden 22 Wohnungen.', link)
    ).toMatch(/fehlt/i)
  })

  // Der Fall aus der Produktion: das Modell verlinkte den blossen Host.
  it('meldet eine erfundene Adresse', () => {
    const erfunden = `Das <a href="https://www.statistik.bl.ch">Statistische Amt</a> meldet.`
    expect(quellenlinkWarnung(erfunden, link)).toMatch(/statt auf/i)
  })

  it('meldet eine zusaetzliche Adresse im Fliesstext', () => {
    expect(
      quellenlinkWarnung(`${gut} Mehr auf https://example.ch/x.`, link)
    ).toMatch(/zusaetzlich/i)
  })

  it('verlangt ohne bekannte Quelle auch keinen Link — aber duldet keinen erfundenen', () => {
    expect(quellenlinkWarnung('Ein Text ohne Adresse.', null)).toBeNull()
    expect(quellenlinkWarnung('Siehe https://example.ch', null)).toMatch(
      /obwohl/i
    )
  })
})

describe('repariereQuellenlink', () => {
  const link = quellenlink({
    ankuendigungLink: null,
    quelleTyp: 'ods',
    externeId: '10230'
  })

  it('zwingt jeden Anker auf die belegte Adresse und laesst den Text stehen', () => {
    const kaputt = `Das <a href="https://www.statistik.bl.ch">Statistische Amt hat neue Daten veroeffentlicht</a>: …`
    expect(repariereQuellenlink(kaputt, link)).toBe(
      `Das <a href="https://data.bl.ch/explore/dataset/10230/">Statistische Amt hat neue Daten veroeffentlicht</a>: …`
    )
  })

  it('vertraegt einfache Anfuehrungszeichen und laesst Richtiges unangetastet', () => {
    expect(
      repariereQuellenlink(`<a href='https://falsch.ch'>Amt</a>`, link)
    ).toBe(`<a href="https://data.bl.ch/explore/dataset/10230/">Amt</a>`)
    const richtig = `<a href="https://data.bl.ch/explore/dataset/10230/">Amt</a>`
    expect(repariereQuellenlink(richtig, link)).toBe(richtig)
  })

  it('ruehrt nichts an, wenn keine Adresse bekannt ist', () => {
    const text = `<a href="https://erfunden.ch">Amt</a>`
    expect(repariereQuellenlink(text, null)).toBe(text)
  })
})
