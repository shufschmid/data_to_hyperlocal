import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  behoerdeAusPfad,
  datumAus,
  imFenster,
  leseKonfiguration,
  oeffentlicheSeite,
  parseDetail,
  parseListe
} from './api'

const lies = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))
const HEUTE = { jahr: 2026, monat: 9, tag: 29 }

describe('leseKonfiguration — die Listen sind eine Zeile', () => {
  const gut = {
    listen: [
      {
        kennung: 'medienmitteilung',
        pfad: '/startseite/ftw-news-newslistingblock',
        name: 'Kanton Basel-Landschaft'
      },
      {
        kennung: 'polizeimeldung',
        pfad: '/startseite/ftw-news-newslistingblock-1/',
        name: 'Polizei Basel-Landschaft'
      }
    ],
    seite: 'https://www.baselland.ch/'
  }

  it('liest zwei Listen und die oeffentliche Seite, ohne Schraegstrich am Ende', () => {
    const k = leseKonfiguration(gut)
    expect(k.seite).toBe('https://www.baselland.ch')
    expect(k.listen[1]?.pfad).toBe('/startseite/ftw-news-newslistingblock-1')
    expect(leseKonfiguration(JSON.stringify(gut)).listen).toHaveLength(2)
  })

  it('verweigert eine unbekannte Kennung, eine fehlende Seite und eine leere Liste', () => {
    expect(() =>
      leseKonfiguration({
        ...gut,
        listen: [{ ...gut.listen[0], kennung: 'x' }]
      })
    ).toThrow(/unvollstaendig/)
    expect(() => leseKonfiguration({ listen: gut.listen })).toThrow(/Seite/)
    expect(() => leseKonfiguration({ seite: gut.seite, listen: [] })).toThrow(
      /keine Liste/
    )
    expect(() => leseKonfiguration(null)).toThrow(/fehlt/)
  })
})

describe('parseListe — die Listenbloecke des Kantons', () => {
  it('liest die Medienmitteilungen: 20 News, neueste zuerst, mit Batching', () => {
    const l = parseListe(lies('medienmitteilungen-liste.json'))
    expect(l.items).toHaveLength(20)
    expect(l.total).toBe(7976)
    expect(l.next).toContain('b_start=20')
    expect(l.items[0]?.titel).toMatch(/Mehrwertabgabe/)
    expect(l.items[0]?.id).toMatch(/^https:\/\/bl-api\.webcloud7\.ch\//)
    // Press releases carry no teaser — the detail has to be opened.
    expect(l.items.filter((i) => i.teaser !== null).length).toBeLessThan(5)
  })

  it('liest die Polizeimeldungen: jede mit Anriss', () => {
    const l = parseListe(lies('polizeimeldungen-liste.json'))
    expect(l.items).toHaveLength(20)
    expect(l.items.every((i) => i.teaser !== null)).toBe(true)
    expect(l.items[0]?.teaser).toMatch(/26\. September 2026/)
  })

  it('ist gegen eine fremde Antwort unempfindlich', () => {
    expect(parseListe(null)).toEqual({ items: [], total: null, next: null })
    expect(
      parseListe({ items: [{ '@type': 'Folder', title: 'x' }] }).items
    ).toEqual([])
  })
})

describe('datumAus und imFenster — 3 von 100 tragen 1969', () => {
  const hundert = parseListe(lies('medienmitteilungen-liste-100.json'))

  it('die 1969-Eintraege bleiben im Fenster, damit das Detail entscheidet', () => {
    const alt = hundert.items.filter((i) =>
      (i.effective ?? '').startsWith('1969')
    )
    expect(alt).toHaveLength(3)
    for (const i of alt) expect(imFenster(i, '2026-09-26', HEUTE)).toBe(true)
    // A plausible old one is out, a plausible recent one in.
    expect(
      imFenster({ effective: '2026-06-23T08:00:00+00:00' }, '2026-09-26', HEUTE)
    ).toBe(false)
    expect(
      imFenster({ effective: '2026-09-27T12:16:51+00:00' }, '2026-09-26', HEUTE)
    ).toBe(true)
  })

  it('nimmt news_date vor effective und nennt die Quelle', () => {
    expect(
      datumAus('2026-09-02T10:00:00', '2026-09-02T08:00:00+00:00', HEUTE)
    ).toEqual({
      datum: '2026-09-02',
      quelle: 'news_date'
    })
    expect(datumAus(null, '2026-09-02T08:00:00+00:00', HEUTE)).toEqual({
      datum: '2026-09-02',
      quelle: 'effective'
    })
    expect(
      datumAus('1969-12-30T22:00:00+00:00', '1969-12-30T22:00:00+00:00', HEUTE)
    ).toEqual({
      datum: null,
      quelle: 'keins'
    })
  })
})

describe('parseDetail — Datum, Tags und Text einer Mitteilung', () => {
  it('Medienmitteilung: Tempo 30 in Muenchenstein', () => {
    const d = parseDetail(lies('medienmitteilung-tempo30.json'))
    expect(d.titel).toMatch(/^Tempo-30-Anträgen in Münchenstein und Birsfelden/)
    expect(d.newsDate).toBe('2026-09-02T10:00:00')
    expect(d.subjects).toEqual(['BL-Home', 'SID-Startseite', 'BUD-Startseite'])
    expect(d.text).toContain(
      'Die Gemeinden Münchenstein und Birsfelden haben Anträge'
    )
    expect(d.text).not.toMatch(/<[a-z]+/)
    expect(d.textAbgeschnitten).toBe(false)
    expect(d.pfad).toBe(
      '/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30-antraegen-in-muenchenstein-und-birsfelden-wird-teilweise-zugestimmt'
    )
  })

  it('Polizeimeldung: Brand in Buus, drei Bloecke in Seitenreihenfolge', () => {
    const d = parseDetail(lies('polizeimeldung-buus.json'))
    expect(d.subjects).toEqual(['Polizeimeldungen'])
    expect(datumAus(d.newsDate, d.effective, HEUTE).datum).toBe('2026-09-24')
    expect(d.text).toMatch(/auf einem Hof im Grien in Buus BL/)
    expect(d.text.indexOf('Brandausbruch')).toBeLessThan(
      d.text.indexOf('Feuerwehr')
    )
    expect(behoerdeAusPfad(d.pfad)).toBe('Polizei Basel-Landschaft')
  })
})

describe('behoerdeAusPfad und oeffentlicheSeite', () => {
  it('liest die Direktion, die Polizei vor ihr, und humanisiert Unbekanntes', () => {
    expect(
      behoerdeAusPfad(
        '/politik-und-behorden/direktionen/bau-und-umweltschutzdirektion/medienmitteilungen/x'
      )
    ).toBe('Bau- und Umweltschutzdirektion')
    expect(
      behoerdeAusPfad(
        '/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/polizeimeldungen/x'
      )
    ).toBe('Polizei Basel-Landschaft')
    expect(
      behoerdeAusPfad(
        '/politik-und-behorden/regierungsrat/medienmitteilungen/x'
      )
    ).toBe('Regierungsrat')
    expect(
      behoerdeAusPfad(
        '/politik-und-behorden/direktionen/neue-direktion/medienmitteilungen/x'
      )
    ).toBe('Neue Direktion')
    expect(behoerdeAusPfad(null)).toBe('Kanton Basel-Landschaft')
  })

  it('tauscht nur den Host — die Seite wird verlinkt, nie geholt', () => {
    expect(
      oeffentlicheSeite(
        'https://bl-api.webcloud7.ch/politik-und-behorden/regierungsrat/medienmitteilungen/x',
        'https://www.baselland.ch/'
      )
    ).toBe(
      'https://www.baselland.ch/politik-und-behorden/regierungsrat/medienmitteilungen/x'
    )
    expect(
      oeffentlicheSeite('kein link', 'https://www.baselland.ch')
    ).toBeNull()
  })
})
