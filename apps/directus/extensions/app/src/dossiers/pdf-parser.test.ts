import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDossier } from './pdf-parser'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

async function loadFixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURES, name))
}

// Hand-verified against SRF's own play-embed links: the Ziefen segment's urn was
// independently confirmed via the SRGSSR API to be
// urn:srf:audio:5b66d4e0-dafd-354e-9ed7-a4f79403a5ec, matching a manually
// link-annotated copy of this same segment (see the project history / HANDOFF.md).
const EXPECTED_ZIEFEN_PARAGRAPHS: { timestamp: string; text: string }[] = [
  {
    timestamp: '00:00:00',
    text: 'SRF-Audio Das ist das Regionaljournal aus Basel heute Mittag mit dem Marcello Capitelli. Die Firma Bachem ist in den letzten Jahren stark gewachsen. Das Unternehmen, das hat mittlerweile einen Standort in den USA, in England und natürlich am Hauptsitz in Bubendorf. Und auch im Baselbiet will der Pharmazulieferer noch weiter ausbauen. 800’000’000 Franken steckt die Bachem in den Standort. Für den Ausbau will Bachem auch die Hilfe von der kleineren Nachbargemeinde in Siffen. Die wehrt sich aber erfolgreich gegen den Weltkonzern. Claudia Kenan'
  },
  {
    timestamp: '00:00:39',
    text: 'Bachrem hat nämlich einen temporären Parkplatz in Sefen bauen wollen, einen für Handwerkerinnen und Bauarbeiter, wo Bachrem für den grossen Ausbau in Bubendorf braucht. Gegen den Parkplatz hat sich in Sefen aber so stark gewehrt, dass Bachrem einen Rückzug gemacht hat, wie die Zeitung Volksstimme als Erste berichtet hat. Bachrem hat das Baugesuch für den Parkplatz nach dem Protest aus Sefen nämlich zurückgezogen. Die Gemeindepräsidentin Cornelia Rudin freut das. Der Gemeinderat habe nicht gewollt, dass das Land sozusagen brachliegt.'
  },
  {
    timestamp: '00:01:11',
    text: 'Wir wollen den Platz wirklich für Gewerbe oder für einen Betrieb, wo aktiv genutzt wird, wo es dann eben auch Arbeitsplätze hätte und so weiter. Und nicht einfach ein Parkplatz, wo brachliegt, so in dem Sinn.'
  },
  {
    timestamp: '00:01:24',
    text: 'In Seewen hat man ausserdem auch Angst gehabt vor dem Verkehr, wo der Parkplatz gebracht hat. Dass der temporäre Parkplatz bald wieder wegkommen würde, hat die Cornelia Ruedi nicht geglaubt.'
  },
  {
    timestamp: '00:01:36',
    text: 'Man sieht ja, wie die Bachem baut und baut. Und wie viele Jahre, dass das ist, das können wir noch nicht sagen.'
  },
  {
    timestamp: '00:01:40',
    text: 'Bachrem hat am Standort Bubendorf viel vor 800’000’000 will der Konzern investieren. Allein in Bubendorf hat er mit 2000 Angestellten mehr Leute als in der 1800 Seelengemeinde Zeven wohnen. Steht da also ein kleines Dorf gegen einen Weltkonzern auf?'
  },
  {
    timestamp: '00:02:00',
    text: 'Das sehen wir nicht so, dass wir da jetzt gegen den Konzern antreiben, sondern Wir möchten einfach für das, wo wir haben, eben für das Grundstück, einfach den richtigen Betrieb haben.'
  },
  {
    timestamp: '00:02:08',
    text: 'Der grosse Ausbau kann Bachrem auch ohne den Parkplatz in Seewen machen, teilt das Unternehmen mit. Man müsse jetzt halt einfach nach anderen Möglichkeiten suchen.'
  },
  {
    timestamp: '00:02:20',
    text: 'Die Claudia Kenan hat berichtet. In unserer Sendung Heute Abend reden wir über Filme aus Basel. Seit 10 Jahren wird das Filmschaffen vom Kanton nämlich deutlich mehr gefördert. In den letzten Jahren habe sich viel getan, sagt der Philipp Kuhn, wo im Vorstand von Balimage ist.'
  },
  {
    timestamp: '00:02:38',
    text: 'In erster Linie hat es ganz viele tolle Filme gegeben in dieser Zeit. Die Szene ist massiv gewachsen, es hat neue Firmen gegeben, wo sich in Basel angesiedelt haben. Es hat eine Dynamik ausgelöst. Und ich glaube, der Filmstandort Basel hat heute in der Schweiz ein ziemlich tolles Image.'
  },
  {
    timestamp: '00:02:56',
    text: 'Wir reden mit dem Philipp Kuhni und einem Basler Regisseur über die Entwicklungen in der Basler Filmszene. Sie hören es heute Abend bei uns im Regionaljournal ab der 5 Uhr 30 Uhr hier auf SRF1.'
  }
]

describe('parseDossier', () => {
  it('matches the known-correct Ziefen segment exactly', async () => {
    const segments = await parseDossier(await loadFixture('Dossier (1).pdf'))
    const ziefen = segments[0]!

    expect(ziefen.broadcastDate).toBe('2026-08-17')
    expect(ziefen.headline).toBe('Ziefen wehrt sich gegen Bachem-Parkplatz')
    expect(ziefen.paragraphs).toHaveLength(EXPECTED_ZIEFEN_PARAGRAPHS.length)
    ziefen.paragraphs.forEach((p, i) => {
      expect(p.timestamp).toBe(EXPECTED_ZIEFEN_PARAGRAPHS[i]!.timestamp)
      expect(p.text).toBe(EXPECTED_ZIEFEN_PARAGRAPHS[i]!.text)
    })
  })

  it('returns the three segments of Dossier (1) in TOC order with correct dates', async () => {
    const segments = await parseDossier(await loadFixture('Dossier (1).pdf'))
    expect(segments.map((s) => s.headline)).toEqual([
      'Ziefen wehrt sich gegen Bachem-Parkplatz',
      'FCB gegen FCB im Joggeli',
      'UPK Basel: Praktikanten haben ADHS-Abklärungen gemacht'
    ])
    expect(segments.map((s) => s.broadcastDate)).toEqual([
      '2026-08-17',
      '2026-08-17',
      '2026-08-16'
    ])
    expect(segments.map((s) => s.paragraphs.length)).toEqual([11, 7, 31])
  })

  it('stitches a paragraph split across a PDF page break into one paragraph', async () => {
    const segments = await parseDossier(await loadFixture('Dossier (2).pdf'))
    const pilz = segments[0]!
    // 00:04:36 starts on page 1 ("...B wären") and continues on page 2
    // ("die Kosten viel höher gewesen...") - it must end up as ONE paragraph.
    const para = pilz.paragraphs.find((p) => p.timestamp === '00:04:36')
    expect(para).toBeDefined()
    expect(para!.text).toContain('B wären')
    expect(para!.text).toContain('die Kosten viel höher gewesen')
    expect(para!.text.indexOf('B wären')).toBeLessThan(
      para!.text.indexOf('die Kosten viel höher gewesen')
    )
    expect(pilz.paragraphs).toHaveLength(78)
  })

  it('splits teaser blocks so the "Ausserdem" paragraph is its own entry', async () => {
    const segments = await parseDossier(await loadFixture('Dossier (1).pdf'))
    const fcb = segments.find((s) => s.headline.includes('FCB gegen FCB'))!
    expect(fcb.teaserBlocks).toHaveLength(2)
    expect(fcb.teaserBlocks[1]).toContain('Ausserdem')
  })

  it('joins a hyphenated word wrapped across a PDF line without an extra space', async () => {
    // the FCB teaser wraps "FCB-Fans" across two PDF lines/columns; it must come
    // back as "FCB-Fans", not "FCB- Fans"
    const segments = await parseDossier(await loadFixture('Dossier (1).pdf'))
    const fcb = segments.find((s) => s.headline.includes('FCB gegen FCB'))!
    expect(fcb.teaserBlocks[0]).toContain('FCB-Fans')
    expect(fcb.teaserBlocks[0]).not.toContain('FCB- Fans')
  })

  it('does not leak the page-footer text or page number into transcript paragraphs', async () => {
    const segments = await parseDossier(await loadFixture('Dossier (1).pdf'))
    for (const segment of segments) {
      for (const paragraph of segment.paragraphs) {
        expect(paragraph.text).not.toContain('Dossier - Bello Bajour')
        expect(paragraph.text).not.toMatch(/\s\d$/) // a trailing lone page number
      }
    }
  })
})
