import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { heuteAus } from '../gemeindeseite/datum'
import { erkennePlattform, ueberDatentuer } from '../gemeindeseite/erkennung'
import { parseAnlassDetail } from './detail'
import {
  anlassAdresse,
  apiAdresse,
  drupalEintraege,
  eintraegeAusAntwort,
  eintragAusItem,
  nurText,
  serienIdVon,
  tagNach,
  TAGES_DECKEL
} from './drupal'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const UEBERSICHT = 'https://www.riehenevents.ch/de/page/agenda'
const HEUTE = heuteAus('2026-09-20')

describe('Erkennung', () => {
  it('erkennt die Vorlage an ihrer Komponente, nicht am Host', () => {
    const html = fixture('riehen-uebersicht.html')
    expect(erkennePlattform(html)).toBe('drupal_termine')
    expect(ueberDatentuer('drupal_termine')).toBe(true)
    expect(ueberDatentuer('iweb_termine')).toBe(false)
  })

  // Die Agenda baut ihre Liste erst im Browser: im rohen HTML steht kein
  // einziger Eintrag. Genau darum wird sie gefragt und nicht geparst — ein
  // Listen-Parser haette hier fuer immer „keine Eintraege" gemeldet.
  it('haelt fest, dass im HTML selbst keine Liste steht', () => {
    const html = fixture('riehen-uebersicht.html')
    expect(/<a[^>]+href="[^"]*\/de\/event\//.test(html)).toBe(false)
    expect(/componentEventList\s*\(/.test(html)).toBe(true)
  })
})

describe('die Adresse der Datentuer', () => {
  it('haengt sie an die Herkunft der erfassten Uebersicht', () => {
    const url = new URL(apiAdresse(UEBERSICHT, '2026-09-20', '2026-09-21'))
    expect(url.origin).toBe('https://www.riehenevents.ch')
    expect(url.pathname).toBe('/de/api/event')
    expect(url.searchParams.get('dateFrom')).toBe('2026-09-20')
    expect(url.searchParams.get('dateTo')).toBe('2026-09-21')
    expect(url.searchParams.get('limit')).toBe(String(TAGES_DECKEL))
    expect(url.searchParams.get('offset')).toBe('0')
  })

  it('zaehlt Tage ueber Monatsgrenzen', () => {
    expect(tagNach(HEUTE, 0)).toBe('2026-09-20')
    expect(tagNach(HEUTE, 11)).toBe('2026-10-01')
    expect(tagNach(HEUTE, 60)).toBe('2026-11-19')
  })
})

describe('ein Vorkommen wird ein Listeneintrag', () => {
  const tag = fixture('riehen-api-tag.json')

  it('liest den Tag der FRAGE, nicht den der Antwort', () => {
    // `day` traegt „So. 20. September" ohne Jahr — ein geratenes Jahr waere
    // genau der Fehler, den die Fuenf-Jahres-Regel verbietet.
    const { eintraege } = eintraegeAusAntwort(JSON.parse(tag), '2026-09-20')
    expect(eintraege.length).toBeGreaterThan(0)
    for (const e of eintraege) expect(e.veranstaltungAm).toBe('2026-09-20')
  })

  it('traegt Titel, Kategorie, Veranstalter und die Seite des Anlasses', () => {
    const { eintraege } = eintraegeAusAntwort(JSON.parse(tag), '2026-09-20')
    const erste = eintraege[0]
    expect(erste?.titel).toBe('Schabbes, Schnitzel, Mehrbettzimmer')
    expect(erste?.kategorie).toBe('Ausstellung')
    expect(erste?.veranstalter).toBe('MUKS - Museum Kultur & Spiel Riehen')
    // Ohne `?date=` — der Link, den eine Leserin oeffnet.
    expect(erste?.url).toBe(
      'https://www.riehenevents.ch/de/event/schabbes-schnitzel-mehrbettzimmer'
    )
  })

  // Ohne diese Zerlegung waere jeder Oeffnungstag eine eigene Serie, und die
  // Ausstellung stuende 52 Mal auf dem Tisch.
  it('macht aus `9838_486` die Serie `9838`', () => {
    expect(serienIdVon('9838_486')).toBe('9838')
    expect(serienIdVon('4493_0')).toBe('4493')
    expect(serienIdVon('ohneunterstrich')).toBe('ohneunterstrich')
    expect(serienIdVon('  ')).toBeNull()
    const { eintraege } = eintraegeAusAntwort(JSON.parse(tag), '2026-09-20')
    expect(eintraege[0]?.serie).toBe('9838')
  })

  it('wirft Marken aus den Feldern und laesst Unbrauchbares weg', () => {
    expect(nurText('<span>22. Mai. 2025 – \n04. Jan. 2027</span>')).toBe(
      '22. Mai. 2025 – 04. Jan. 2027'
    )
    expect(nurText('<span> </span>')).toBeNull()
    expect(nurText(42)).toBeNull()
    expect(anlassAdresse('keine url')).toBeNull()
    expect(eintragAusItem({ id: '1_0', title: 'X' }, '2026-09-20')).toBeNull()
    expect(
      eintragAusItem({ title: 'X', url: 'https://a.ch/b' }, '2026-09-20')
    ).toBeNull()
  })

  it('meldet einen gegriffenen Deckel, statt still zu kuerzen', () => {
    const voll = {
      items: Array.from({ length: TAGES_DECKEL }, (_, i) => ({
        id: `${i}_0`,
        title: `Anlass ${i}`,
        url: `https://www.riehenevents.ch/de/event/a${i}`
      }))
    }
    expect(eintraegeAusAntwort(voll, '2026-09-20').abgeschnitten).toBe(true)
    expect(eintraegeAusAntwort({ items: [] }, '2026-09-20').abgeschnitten).toBe(
      false
    )
  })
})

describe('das Fenster Tag fuer Tag', () => {
  it('fragt jeden Tag einzeln — gemessen, weil eine Woche am Stueck Eintraege verliert', async () => {
    const gefragt: string[] = []
    const leser = {
      liesJson: vi.fn(async (url: string) => {
        gefragt.push(new URL(url).searchParams.get('dateFrom') ?? '')
        return { items: [], count: 0, total: 0 }
      })
    }
    await drupalEintraege(leser, UEBERSICHT, HEUTE, 3)
    expect(gefragt).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23'
    ])
  })

  it('ein gescheiterter Tag kostet den Tag und nicht den Kalender — und wird genannt', async () => {
    const leser = {
      liesJson: vi.fn(async (url: string) => {
        if (url.includes('dateFrom=2026-09-21'))
          throw new Error('Zeitueberschreitung')
        return {
          items: [
            {
              id: '1_0',
              title: 'Markt',
              url: 'https://www.riehenevents.ch/de/event/markt'
            }
          ]
        }
      })
    }
    const ergebnis = await drupalEintraege(leser, UEBERSICHT, HEUTE, 2)
    expect(ergebnis.eintraege).toHaveLength(2)
    expect(ergebnis.fehler).toEqual(['2026-09-21: Zeitueberschreitung'])
  })
})

describe('die Detailseite', () => {
  it('liest die beschriftete Seitenleiste — Ort, Zeit, Preis, Veranstalter', () => {
    const detail = parseAnlassDetail(
      fixture('riehen-anlass.html'),
      'drupal',
      'https://www.riehenevents.ch/de/event/sofalesung-mit-julia-trachsel',
      heuteAus('2026-10-01')
    )
    expect(detail.titel).toContain('Sofalesung')
    expect(detail.ort).toBe('Riehen')
    expect(detail.zeit).toContain('17:00')
    expect(detail.preis).toContain('CHF 10/20/30')
    expect(detail.veranstalter).toBe('Verein Sofalesungen')
    expect(detail.kategorie).toBe('Literatur')
    expect(detail.weitereTermine).toEqual(['2026-10-18'])
    expect(detail.beschreibung).toContain('Graphic Novel')
    expect(detail.verfahren).toBe('drupal')
  })
})
