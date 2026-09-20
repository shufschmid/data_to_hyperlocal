import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { heuteAus } from '../gemeindeseite/datum'
import { parseAnlassDetail, parseTraktanden, TRAKTANDEN_MAX } from './detail'

const HEUTE = heuteAus('2026-09-19')
const lies = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('Weblication: das Formular ist Felder', () => {
  it('bottmingen: Datum/Zeit, Lokalitaet, Strasse, Ort, Veranstalter, Beschreibung, Dokument', () => {
    const d = parseAnlassDetail(
      lies('bottmingen-anlass.html'),
      'weblication',
      'https://www.bottmingen.ch/de/veranstaltungen/13041_geschichtenzeit',
      HEUTE
    )
    expect(d).toMatchObject({
      titel: 'Geschichtenzeit mit Bilobuh, dem kleinen Schlossgespenst',
      zeit: '14:30–15:15',
      lokalitaet: 'Bibliothek Bottmingen',
      adresse: 'Schlossgasse 10',
      ort: 'Bottmingen',
      veranstalter: 'Bibliothek Bottmingen',
      kategorie: 'Diverse, Freizeit, Kinder- und Jugendangebot',
      weitereTermine: ['2026-09-23'],
      verfahren: 'weblication'
    })
    expect(d.beschreibung).toContain('Anmeldung bis 21. September')
    expect(d.beschreibung).not.toContain('Telefon')
    expect(d.dokumente).toHaveLength(1)
    expect(d.dokumente[0]?.url).toMatch(/Bilobuh_Flyer.*\.pdf$/)
  })

  it('reinach: dieselbe Form, der Ort mit Adresse in mehreren Zeilen', () => {
    const d = parseAnlassDetail(
      lies('reinach-anlass.html'),
      'weblication',
      'https://www.reinach-bl.ch/de/veranstaltungen/detail/detail.php?i=11075',
      HEUTE
    )
    expect(d).toMatchObject({
      titel: "Palais z'Nacht für Jugendliche",
      zeit: '16:00–20:00',
      lokalitaet: 'Jugendhaus',
      veranstalter: 'Team Jugendhaus',
      weitereTermine: ['2026-09-22']
    })
    expect(d.ort).toContain('Reinach')
    expect(d.beschreibung).toContain('jeweils am Dienstagabend')
  })
})

describe('i-web: Adresse, Datumszeile, Kontakt, Informationen', () => {
  it('pratteln: Markt des Alterns', () => {
    const d = parseAnlassDetail(
      lies('pratteln-anlass.html'),
      'iweb',
      'https://www.pratteln.ch/_rte/anlass/7353004',
      HEUTE
    )
    expect(d).toMatchObject({
      titel: 'Markt des Alterns',
      zeit: '13:00–18:00',
      lokalitaet: 'Kultur- und Sportzentrum',
      ort: 'Pratteln',
      veranstalter: 'Gemeinde Pratteln',
      anmeldung: 'Keine Anmeldung notwendig.',
      weitereTermine: ['2026-09-25'],
      verfahren: 'iweb'
    })
    expect(d.beschreibung).toContain('Organisationen aus ambulanten')
    expect(d.dokumente.map((x) => x.url)).toContain(
      'https://www.pratteln.ch/_doc/6768274'
    )
  })

  it('pratteln: eine Ausstellung mit Spanne und Preis-Feld', () => {
    const d = parseAnlassDetail(
      lies('pratteln-ausstellung.html'),
      'iweb',
      'https://www.pratteln.ch/_rte/anlass/7535929',
      HEUTE
    )
    expect(d.weitereTermine).toEqual(['2026-08-10', '2027-03-21'])
    expect(d.zeit).toBe('14:00–17:00')
    expect(d.beschreibung).toContain('Mi/Fr/Sa/So')
  })

  it('muenchenstein: die Laufgruppe nennt Preis und Anmeldung als Felder', () => {
    const d = parseAnlassDetail(
      lies('muenchenstein-laufgruppe.html'),
      'iweb',
      'https://www.muenchenstein.ch/_rte/anlass/7468570',
      HEUTE
    )
    expect(d).toMatchObject({
      preis: 'Die Teilnahme ist kostenlos.',
      anmeldung: 'Keine Anmeldung nötig.',
      veranstalter: 'Koordinationsstelle für das Alter und der Seniorenrat',
      weitereTermine: ['2026-05-07', '2026-12-17']
    })
  })

  it('muttenz: eine verschobene Fuehrung sagt es im Text', () => {
    const d = parseAnlassDetail(
      lies('muttenz-waldfuehrung.html'),
      'iweb',
      'https://www.muttenz.ch/anlass/7305533',
      HEUTE
    )
    expect(d.beschreibung).toMatch(
      /vom 19\. September auf den 26\. September verschoben/
    )
    expect(d.weitereTermine).toEqual(['2026-09-26'])
    expect(d.veranstalter).toBe('Bürgergemeinde Muttenz')
  })

  it('pratteln: die Sitzungsseite eines Gremiums traegt Datum, Ort und die Traktanden als Tabelle', () => {
    const html = lies('pratteln-sitzung.html')
    const d = parseAnlassDetail(
      html,
      'iweb',
      'https://www.pratteln.ch/sitzungen/6847363',
      HEUTE
    )
    expect(d).toMatchObject({
      titel: 'Einwohnerrat',
      zeit: '19:00',
      lokalitaet: 'Alte Dorfturnhalle',
      weitereTermine: ['2026-09-21']
    })
    const { liste, abgeschnitten } = parseTraktanden(html)
    expect(abgeschnitten).toBe(false)
    expect(liste.length).toBeGreaterThan(8)
    expect(liste[0]).toMatch(/^01 Ersatzwahl eines Ersatzmitgliedes/)
    expect(liste.some((t) => /Schnellzugshalt in Pratteln/.test(t))).toBe(true)
    expect(liste.some((t) => /Fragestunde/.test(t))).toBe(true)
  })

  it('muenchenstein: die Gemeindeversammlung fuehrt die Traktanden als Liste in der Beschreibung', () => {
    const html = lies('muenchenstein-gemeindeversammlung.html')
    const { liste } = parseTraktanden(html)
    expect(liste).toHaveLength(6)
    expect(liste[1]).toBe(
      'Einführung der ausserordentlichen Gemeindeorganisation (Einwohnerrat)'
    )
    expect(liste[5]).toMatch(/^Verschiedenes — 6\.1\./)
  })

  it('muttenz: eine abgesagte Sitzung hat keine Traktanden, und das ist kein Fehler', () => {
    expect(
      parseTraktanden(lies('muttenz-sitzung-abgesagt.html')).liste
    ).toEqual([])
  })
})

describe('Backslash: Inhalt, Ort, alle Termine, Sitzungslink', () => {
  it('binningen: Meditation am Montag mit der ganzen Terminliste', () => {
    const d = parseAnlassDetail(
      lies('binningen-anlass.html'),
      'backslash',
      'https://www.binningen.ch/de/gemeinde/news-und-medien/veranstaltungen.html/987/event/8967/eventdate/18813',
      HEUTE
    )
    expect(d).toMatchObject({
      titel: 'Meditation am Montag',
      zeit: '19:30–20:45',
      lokalitaet: 'Paradieskirche',
      adresse: 'Langegasse 60',
      ort: 'Binningen',
      verfahren: 'backslash'
    })
    expect(d.weitereTermine.length).toBeGreaterThan(15)
    expect(d.weitereTermine[0]).toBe('2026-09-21')
    expect(d.weitereTermine).toContain('2027-06-21')
    expect(d.beschreibung).toContain('christlicher Kontemplation')
    expect(d.traktandenLink).toBeNull()
  })

  it('binningen: die Einwohnerratssitzung verlinkt die Sitzungsseite, deren Abschnitt der Tag waehlt', () => {
    const d = parseAnlassDetail(
      lies('binningen-einwohnerrat.html'),
      'backslash',
      'https://www.binningen.ch/de/gemeinde/news-und-medien/veranstaltungen.html/987/event/2648/eventdate/18512',
      HEUTE
    )
    expect(d.traktandenLink).toBe(
      'https://www.binningen.ch/de/gemeinde/politik/einwohnerrat/sitzungen/die-sitzungen-im-jahr-2026.html/1329'
    )
    expect(d.weitereTermine[0]).toBe('2026-09-21')
    const { liste } = parseTraktanden(
      lies('binningen-sitzungen.html'),
      '2026-09-21'
    )
    expect(liste.length).toBeGreaterThan(8)
    expect(liste[0]).toBe(
      '150 Ersatzwahl eines Ersatzmitglieds der Rechnungsprüfungskommission'
    )
    expect(liste.some((t) => /Binninger Boden behalten/.test(t))).toBe(true)
    expect(liste.some((t) => /Einladung/.test(t))).toBe(false)
    // Another day picks another section.
    const august = parseTraktanden(
      lies('binningen-sitzungen.html'),
      '2026-08-24'
    ).liste
    expect(august.length).toBeGreaterThan(0)
    expect(august[0]).not.toBe(liste[0])
  })

  it('deckelt die Traktanden und sagt es', () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) => `<tr><td>${i + 1}</td><td>Geschäft ${i + 1}</td></tr>`
    ).join('')
    const html = `<h2>Traktanden</h2><table>${rows}</table>`
    const { liste, abgeschnitten } = parseTraktanden(html)
    expect(liste).toHaveLength(TRAKTANDEN_MAX)
    expect(abgeschnitten).toBe(true)
  })
})
