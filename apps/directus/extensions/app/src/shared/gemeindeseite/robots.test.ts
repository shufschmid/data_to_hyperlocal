import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  crawlDelaySekunden,
  darfLesen,
  gruppeFuer,
  parseRobots
} from './robots'

const lies = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('robots.txt der registrierten Gemeinden', () => {
  it('riehen: erlaubt alles, bittet um zehn Sekunden Abstand', () => {
    const regeln = parseRobots(lies('riehen-robots.txt'))
    expect(darfLesen(regeln, '/aktuelles/')).toBe(true)
    expect(crawlDelaySekunden(regeln)).toBe(10)
  })

  it('binningen: sperrt /route/ — wo das RSS liegt — und sonst nichts', () => {
    const regeln = parseRobots(lies('binningen-robots.txt'))
    expect(
      darfLesen(
        regeln,
        '/route/rss-rss-getRss/entitylist/2/entitytype/189/lang/1'
      )
    ).toBe(false)
    expect(
      darfLesen(regeln, '/de/gemeinde/news-und-medien/news.html/106/news/6797')
    ).toBe(true)
    expect(crawlDelaySekunden(regeln)).toBeNull()
  })

  it('allschwil: Platzhalter-Regeln treffen die Suche, nicht den Kategorie-Filter; fremde Bot-Gruppen gelten nicht fuer uns', () => {
    const regeln = parseRobots(lies('allschwil-robots.txt'))
    expect(darfLesen(regeln, '/de/aktuelles/?categories[]=1177055180125')).toBe(
      true
    )
    expect(darfLesen(regeln, '/de/suche/?searchTerm=x')).toBe(false)
    expect(darfLesen(regeln, '/de/aktuelles/?kategorie_id=5')).toBe(false)
    expect(gruppeFuer(regeln)?.agents).toEqual(['*'])
    expect(crawlDelaySekunden(regeln)).toBeNull()
  })

  it('reinach: eine Zeile ohne Doppelpunkt wird ignoriert, Allow: / gilt', () => {
    const regeln = parseRobots(lies('reinach-robots.txt'))
    expect(darfLesen(regeln, '/de/aktuell/')).toBe(true)
    expect(gruppeFuer(regeln)?.disallow).toEqual([])
  })
})

describe('parseRobots', () => {
  it('nimmt die Gruppe, die uns beim Namen nennt, vor der allgemeinen', () => {
    const regeln = parseRobots(
      `User-agent: *\nDisallow: /\n\nUser-agent: DieRedaktion\nAllow: /aktuelles/\nDisallow: /intern/\nCrawl-delay: 3\n`
    )
    expect(darfLesen(regeln, '/aktuelles/x.php')).toBe(true)
    expect(darfLesen(regeln, '/intern/x')).toBe(false)
    expect(darfLesen(regeln, '/sonst')).toBe(true)
    expect(crawlDelaySekunden(regeln)).toBe(3)
  })

  it('ohne Gruppe fuer uns gibt es keine Einschraenkung', () => {
    expect(darfLesen(parseRobots(''), '/x')).toBe(true)
    expect(
      darfLesen(parseRobots('User-agent: Googlebot\nDisallow: /'), '/x')
    ).toBe(true)
  })

  it('ein leeres Disallow sperrt nichts, CRLF und BOM stoeren nicht', () => {
    const regeln = parseRobots(
      '﻿User-agent: *\r\nDisallow:\r\nCrawl-delay: 2,5\r\n'
    )
    expect(darfLesen(regeln, '/x')).toBe(true)
    expect(crawlDelaySekunden(regeln)).toBe(2.5)
  })

  it('der laengste Treffer entscheidet, bei Gleichstand Allow', () => {
    const regeln = parseRobots('User-agent: *\nDisallow: /a/\nAllow: /a/b/\n')
    expect(darfLesen(regeln, '/a/x')).toBe(false)
    expect(darfLesen(regeln, '/a/b/x')).toBe(true)
    const gleich = parseRobots('User-agent: *\nDisallow: /a/\nAllow: /a/\n')
    expect(darfLesen(gleich, '/a/x')).toBe(true)
  })

  it('versteht * und $ in Mustern', () => {
    const regeln = parseRobots(
      'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?druck='
    )
    expect(darfLesen(regeln, '/docs/a.pdf')).toBe(false)
    expect(darfLesen(regeln, '/docs/a.pdf?x=1')).toBe(true)
    expect(darfLesen(regeln, '/seite?druck=1')).toBe(false)
  })

  it('aufeinanderfolgende User-agent-Zeilen teilen eine Gruppe', () => {
    const regeln = parseRobots(
      'User-agent: A\nUser-agent: DieRedaktion\nDisallow: /geheim\n'
    )
    expect(darfLesen(regeln, '/geheim/x')).toBe(false)
  })
})
