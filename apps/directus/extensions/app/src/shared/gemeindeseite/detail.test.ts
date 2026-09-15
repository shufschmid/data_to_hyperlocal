import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { heuteAus } from './datum'
import {
  inhaltsblockWeblication,
  metaTitel,
  parseDetail,
  parseGenerischesDetail
} from './detail'

const HEUTE = heuteAus('2026-09-14')
const lies = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('Weblication', () => {
  it('riehen: Titel aus dem Block, Datum aus der Subline, Lead, Text ohne den per Skript geschriebenen Zurueck-Link', () => {
    const d = parseDetail(
      lies('riehen-detail.html'),
      'weblication',
      'https://www.riehen.ch/aktuelles/meldungen/Unterstuetzung-fuer-die-Opfer-der-Sturzflut-in-Nepal.php',
      HEUTE
    )
    expect(d.verfahren).toBe('weblication')
    expect(d.titel).toBe('Unterstützung für die Opfer der Sturzflut in Nepal')
    expect(d.datum).toBe('2026-09-03')
    expect(d.lead).toMatch(
      /^Die Gemeinde Riehen unterstützt die humanitäre Hilfe/
    )
    expect(d.text).toMatch(
      /^Am Mittwoch, 26\. Juni 2026, hat eine verheerende Sturzflut/
    )
    expect(d.text).toContain('Riehen, 3. September 2026')
    expect(d.text).not.toContain('Zurück')
    expect(d.text).not.toContain('document.write')
    expect(d.text).not.toContain(d.titel ?? '§')
    expect(d.dokumente).toEqual([])
    expect(d.kanonisch).toBeNull()
  })

  it('bottmingen: der Titel kommt nicht vom ersten h1 („Top-Begriffe“), die verschachtelten Marker stoeren nicht', () => {
    const url =
      'https://www.bottmingen.ch/de/aktuelles/meldungen/Kantonaler-Fuehrungsstab-Teilstab-Trockenheit-wird-deaktiviert.php'
    const d = parseDetail(
      lies('bottmingen-detail.html'),
      'weblication',
      url,
      HEUTE
    )
    expect(d.titel).toBe('Kantonaler Teilstab Trockenheit wird deaktiviert')
    expect(d.datum).toBe('2026-09-14')
    expect(d.lead).toMatch(/^Die Lage hat sich aufgrund der Niederschläge/)
    expect(d.text).toMatch(
      /^Angesichts der aktuellen Entwicklung hat der Regierungsrat/
    )
    expect(d.text).not.toContain('Top-Begriffe')
    expect(d.text).not.toContain('Datenschutzhinweis')
    expect(d.kanonisch).toBe(url)
  })

  it('reinach: Block ueber die Klasse gefunden, Datum mit Leerzeichen, Dokumente der Seitenleiste bleiben draussen', () => {
    const url =
      'https://www.reinach-bl.ch/de/aktuell/news/meldungen-gemeinde/News-2026/Blaulichttag.php'
    const d = parseDetail(
      lies('reinach-detail.html'),
      'weblication',
      url,
      HEUTE
    )
    expect(d.titel).toBe('Blaulichttag der Feuerwehr Birs am 19. September')
    expect(d.datum).toBe('2026-09-08')
    expect(d.lead).toMatch(/^Die Feuerwehr Birs lädt die Bevölkerung/)
    expect(d.text).toMatch(/^Der Blaulichttag startet um 13 Uhr/)
    expect(d.dokumente).toEqual([])
    expect(d.kanonisch).toBe(url)
  })

  it('inhaltsblockWeblication: zaehlt verschachtelte Marker und gibt ohne Anker null zurueck', () => {
    const html =
      '<div id="blockContentInner"><!--CONTENT:START-->A<div id="pageContent1"><!--CONTENT:START-->B<!--CONTENT:STOP--></div>C<!--CONTENT:STOP--><div>D</div>'
    expect(inhaltsblockWeblication(html)).toBe(
      'A<div id="pageContent1"><!--CONTENT:START-->B<!--CONTENT:STOP--></div>C'
    )
    expect(inhaltsblockWeblication('<div>kein Block</div>')).toBeNull()
  })
})

describe('i-web', () => {
  it('aesch: Lead aus dem Lead-Container, Aufzaehlung als Striche, kein Footer-Block, kanonische Adresse', () => {
    const d = parseDetail(
      lies('aesch-detail.html'),
      'iweb',
      'https://www.aesch.bl.ch/_rte/information/2982256',
      HEUTE
    )
    expect(d.verfahren).toBe('iweb')
    expect(d.titel).toBe('Aus der Gemeinderatssitzung vom 08. September 2026')
    expect(d.datum).toBe('2026-09-11')
    expect(d.lead).toBe(
      'In seiner Sitzung vom 08. September 2026 hat der Gemeinderat unter anderem folgende Themen behandelt:'
    )
    expect(d.text).toMatch(
      /^– Der Gemeinderat hat die Traktanden für die Gemeindeversammlung vom 07\. Dezember 2026 beschlossen\./
    )
    expect(d.text).toContain('Alterszentrum Im Brüel')
    expect(d.text).not.toContain('Achtung: An bzw.')
    expect(d.text).not.toContain('Zugehörige Objekte')
    expect(d.kanonisch).toBe(
      'https://www.aesch.bl.ch/aktuellesinformationen/2982256'
    )
  })

  it('muenchenstein: Titel trotz sr-only-h1s, zwei Dokumente hinter /_doc/ mit Typ und Groesse, der Download-Knopf zaehlt nicht doppelt', () => {
    const d = parseDetail(
      lies('muenchenstein-detail.html'),
      'iweb',
      'https://www.muenchenstein.ch/_rte/information/2982502',
      HEUTE
    )
    expect(d.titel).toBe(
      'Waldbrandgefahr sinkt auf Stufe 3 - Lockerung des Feuerverbots'
    )
    expect(d.datum).toBe('2026-09-11')
    expect(d.text).toMatch(
      /^Wie der Führungsstab des Kantons Basel-Landschaft mitteilt/
    )
    expect(d.dokumente).toEqual([
      {
        bezeichnung: 'Medienmitteilung Kantonaler Führungsstab',
        url: 'https://www.muenchenstein.ch/_doc/7217551',
        typHinweis: '(PDF, 171 kB)'
      },
      {
        bezeichnung: 'Waldbrandgefahr - Verfügung vom 10. September 2026',
        url: 'https://www.muenchenstein.ch/_doc/7217554',
        typHinweis: '(PDF, 76 kB)'
      }
    ])
  })
})

describe('Backslash', () => {
  it('binningen: Titel, Zeitstempel, Lead, Text, keine Druck-Selbstlinks als Dokumente', () => {
    const url =
      'https://www.binningen.ch/de/gemeinde/news-und-medien/news.html/106/news/6797'
    const d = parseDetail(
      lies('binningen-detail.html'),
      'backslash',
      url,
      HEUTE
    )
    expect(d.verfahren).toBe('backslash')
    expect(d.titel).toBe(
      'Jubiläumsglanzpunkt der Musikschule Binningen-Bottmingen: Abendblätter'
    )
    expect(d.datum).toBe('2026-09-10')
    expect(d.lead).toMatch(
      /^Am Dienstag, 15\. September 2026, gestalten die Pianisten/
    )
    expect(d.text).toContain('Robert Schumann')
    expect(d.text).toContain('Kronenmattsaal, Binningen')
    expect(d.dokumente).toEqual([])
    expect(d.kanonisch).toBe(url)
  })
})

describe('generischer Fallback', () => {
  const fremd =
    '<html><head><title>Neue Buslinie - Gemeinde Musterwil</title></head><body><header>Navigation</header>' +
    '<main><h2>Neue Buslinie</h2><p>Ab dem 1. Oktober 2026 fährt die Linie 60.</p><a href="/docs/fahrplan.pdf">Fahrplan</a></main>' +
    '<footer>Öffnungszeiten</footer></body></html>'

  it('nimmt Titel aus dem Seitentitel, Text ohne Kopf und Fuss, Dokumente', () => {
    const d = parseGenerischesDetail(
      fremd,
      'https://www.musterwil.ch/news/1',
      HEUTE
    )
    expect(d.titel).toBe('Neue Buslinie')
    expect(d.text).toBe(
      'Neue Buslinie\n\nAb dem 1. Oktober 2026 fährt die Linie 60.\n\nFahrplan'
    )
    expect(d.text).not.toContain('Navigation')
    expect(d.dokumente).toEqual([
      {
        bezeichnung: 'Fahrplan',
        url: 'https://www.musterwil.ch/docs/fahrplan.pdf',
        typHinweis: null
      }
    ])
    expect(d.datum).toBeNull()
  })

  it('springt ein, wenn der Familien-Parser keinen Text findet, und sagt es', () => {
    const d = parseDetail(
      fremd,
      'weblication',
      'https://www.musterwil.ch/news/1',
      HEUTE
    )
    expect(d.verfahren).toBe('generisch')
    expect(d.titel).toBe('Neue Buslinie')
    expect(d.text).toContain('Linie 60')
  })

  it('metaTitel: og:title zuerst, sonst das laengste Stueck des Seitentitels', () => {
    expect(
      metaTitel(
        '<meta property="og:title" content="Aus dem Gemeinderat"><title>Aesch BL - Aus dem Gemeinderat</title>'
      )
    ).toBe('Aus dem Gemeinderat')
    expect(
      metaTitel(
        '<title>Aesch BL - Aus der Gemeinderatssitzung vom 08. September 2026 </title>'
      )
    ).toBe('Aus der Gemeinderatssitzung vom 08. September 2026')
    expect(
      metaTitel('<title>Abendblätter – \nGemeinde Binningen</title>')
    ).toBe('Abendblätter')
    expect(metaTitel('<html></html>')).toBeNull()
  })
})
