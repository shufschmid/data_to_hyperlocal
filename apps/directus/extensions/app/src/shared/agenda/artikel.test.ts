import { describe, expect, it } from 'vitest'
import { ARTIKEL_MAX_ZEICHEN, istWebartikel, parseArtikel } from './artikel'

// Nachgebaut aus dem echten Webartikel „Bau- und Wohnbaustatistik 2025“: er
// verlinkt zwei Portaltabellen und eine data.bl.ch-SUCHE — keinen einzelnen
// Datensatz. Genau deshalb reicht eine ID-Regex nicht.
const ARTIKEL = `
<html><head><style>.x{color:red}</style></head><body>
<script>var t = "nicht im Text";</script>
<h1>Bau- und Wohnbaustatistik 2025</h1>
<p>Im Kanton Basel-Landschaft wurden 2025 insgesamt 1&#39;204 Wohnungen neu erstellt.
Der Wohnungsbestand w&auml;chst damit weiter &ndash; besonders im Bezirk Arlesheim.</p>
<a href="https://statistik.bl.ch/web_portal/9_1">Tabelle 9_1</a>
<a href="https://statistik.bl.ch/web_portal/9_1_6">Tabelle 9_1_6</a>
<a href="https://data.bl.ch/explore/?sort=title&amp;disjunctive.theme&amp;q=Wohnbaustatistik">Alle Daten</a>
</body></html>
`

describe('parseArtikel', () => {
  const artikel = parseArtikel(ARTIKEL)

  it('liest den lesbaren Text ohne Skript und Stil', () => {
    expect(artikel.text).toContain("1'204 Wohnungen neu erstellt")
    expect(artikel.text).toContain('wächst damit weiter – besonders')
    expect(artikel.text).not.toContain('nicht im Text')
    expect(artikel.text).not.toContain('color:red')
  })

  it('sammelt die verlinkten Portaltabellen', () => {
    expect(artikel.tabellen).toEqual(['9_1', '9_1_6'])
  })

  it('liest den Suchbegriff der Portalsuche — keine ID, aber ein Hinweis', () => {
    expect(artikel.suchbegriffe).toEqual(['Wohnbaustatistik'])
    expect(artikel.datensaetze).toEqual([])
  })

  it('nimmt eine direkt verlinkte Datensatz-ID mit, wo es sie gibt', () => {
    const mitId = parseArtikel(
      '<a href="https://data.bl.ch/explore/dataset/12060/table/">Abfallmengen</a>'
    )
    expect(mitId.datensaetze).toEqual(['12060'])
  })

  it('deckelt die Laenge', () => {
    const lang = parseArtikel(`<p>${'wort '.repeat(4000)}</p>`)
    expect(lang.text.length).toBeLessThanOrEqual(ARTIKEL_MAX_ZEICHEN)
  })

  it('macht aus einer kaputten Seite kein Drama', () => {
    const leer = parseArtikel('')
    expect(leer.text).toBe('')
    expect(leer.tabellen).toEqual([])
  })
})

describe('istWebartikel', () => {
  it('erkennt die Artikel des Amts', () => {
    expect(
      istWebartikel(
        'https://www.baselland.ch/politik-und-behorden/…/webartikel-vom-21-08-2026-bau-und-wohnbaustatistik-2025'
      )
    ).toBe(true)
  })

  it('haelt Portallinks und Fehlendes heraus', () => {
    expect(istWebartikel('https://statistik.bl.ch/web_portal/9_1')).toBe(false)
    expect(istWebartikel('https://www.baselland.ch/irgendwas')).toBe(false)
    expect(istWebartikel(null)).toBe(false)
  })
})
