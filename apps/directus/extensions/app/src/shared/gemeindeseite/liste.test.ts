import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { heuteAus } from './datum'
import {
  oderNull,
  KAPUTTE_SPALTE_AB,
  istAbgesagt,
  parseListe,
  parseTerminZeile,
  parseWeblicationListe,
  zeitText
} from './liste'

const HEUTE = heuteAus('2026-09-14')
const lies = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('Weblication', () => {
  it('riehen: Titel, Teaser, Datum aus der Datumszeile, ein direkt verlinktes PDF, ein angepinnter aelterer Eintrag zuoberst', () => {
    const liste = parseListe(
      lies('riehen-uebersicht.html'),
      'weblication',
      'https://www.riehen.ch/aktuelles/',
      HEUTE
    )
    expect(liste).toHaveLength(11)
    expect(liste[0]).toMatchObject({
      url: 'https://www.riehen.ch/aktuelles/meldungen/Trickbetrueger-in-Riehen.php',
      titel:
        'Trickbetrüger: Vorsicht bei Besuchen von angeblichen Gemeindemitarbeitenden',
      datum: '2026-08-19',
      datumQuelle: 'liste',
      direktPdf: false
    })
    expect(liste[0]?.teaser).toMatch(/^Immer wieder nehmen Personen Kontakt/)
    const pdf = liste.filter((e) => e.direktPdf)
    expect(pdf).toHaveLength(1)
    expect(pdf[0]?.url).toBe(
      'https://www.riehen.ch/wAssets/docs/aktuelles/medienmitteilungen/MM_Maisondesheuresperdues_Kunst-Raum-Riehen.pdf'
    )
    expect(liste.every((e) => e.datum !== null)).toBe(true)
    expect(liste.some((e) => /\d{2}\.\d{2}\.\d{4}/.test(e.titel))).toBe(false)
  })

  it('bottmingen: das Kalender-Kaestchen schlaegt die Datumszeile, die auf jedem Eintrag den Abruftag zeigt', () => {
    const liste = parseListe(
      lies('bottmingen-uebersicht.html'),
      'weblication',
      'https://www.bottmingen.ch/de/aktuelles/',
      HEUTE
    )
    expect(liste).toHaveLength(20)
    expect(liste[0]).toMatchObject({
      titel: 'Kantonaler Teilstab Trockenheit wird deaktiviert',
      datum: '2026-09-14',
      datumQuelle: 'kalender'
    })
    expect(liste[1]).toMatchObject({
      titel: 'Pilzkontrolle: Essbar oder giftig?',
      datum: '2026-09-10',
      datumQuelle: 'kalender'
    })
    expect(liste[19]).toMatchObject({
      datum: '2026-07-10',
      datumQuelle: 'kalender'
    })
    expect(liste.every((e) => e.datumQuelle === 'kalender')).toBe(true)
    // Nine of twenty would read as "today" from the broken column; the badge knows better.
    expect(liste.filter((e) => e.datum === '2026-09-14')).toHaveLength(1)
  })

  it('reinach: die Datumsspanne steckt im Titel und wird herausgeloest; ein Eintrag ohne Datum bleibt undatiert', () => {
    const liste = parseListe(
      lies('reinach-uebersicht.html'),
      'weblication',
      'https://www.reinach-bl.ch/de/aktuell/',
      HEUTE
    )
    expect(liste).toHaveLength(10)
    expect(liste[0]).toMatchObject({
      url: 'https://www.reinach-bl.ch/de/aktuell/news/meldungen-gemeinde/News-2026/Blaulichttag.php',
      titel: 'Blaulichttag der Feuerwehr Birs am 19. September',
      datum: '2026-09-08',
      datumQuelle: 'liste'
    })
    expect(liste.filter((e) => e.datum === null)).toHaveLength(1)
    expect(
      liste.some((e) =>
        e.titel.includes('Amtliche Mitteilungen der KW 37/2026')
      )
    ).toBe(true)
  })

  it('allschwil: zwanzig datierte Eintraege, kein Datum aus dem Dateinamen in der Navigation, kein Query-String an den Links', () => {
    const liste = parseListe(
      lies('allschwil-uebersicht.html'),
      'weblication',
      'https://www.allschwil.ch/de/aktuelles/?categories[]=1177055180125',
      HEUTE
    )
    expect(liste).toHaveLength(20)
    expect(liste[0]).toMatchObject({
      titel: 'Waldbrandgefahr sinkt auf Stufe 3 – Lockerung des Feuerverbots',
      datum: '2026-09-11'
    })
    expect(liste.every((e) => e.datum !== null)).toBe(true)
    expect(liste.some((e) => e.url.includes('Sitzordnung'))).toBe(false)
    expect(liste.some((e) => e.url.includes('?'))).toBe(false)
  })

  it('nimmt den Link aus data-url, wenn der Titel keinen Anker hat, und verwirft Eintraege ohne Titel', () => {
    const html =
      '<li class="listEntry" data-url="/de/x.php"><div class="listEntryTitle">Nur Text</div><div class="listEntryDate">01.09.2026</div></li>' +
      '<li class="listEntry" data-url="/de/leer.php"><div class="listEntryTitle"></div></li>'
    const liste = parseWeblicationListe(
      html,
      'https://www.example.ch/de/',
      HEUTE
    )
    expect(liste).toEqual([
      {
        url: 'https://www.example.ch/de/x.php',
        titel: 'Nur Text',
        teaser: null,
        datum: '2026-09-01',
        datumQuelle: 'liste',
        kategorie: null,
        direktPdf: false,
        veranstaltungAm: null,
        veranstaltungBis: null,
        zeit: null,
        lokalitaet: null,
        ort: null,
        veranstalter: null,
        serie: null,
        serieSeit: null,
        abgesagt: false
      }
    ])
  })
})

describe('i-web', () => {
  it('aesch: das ganze Archiv aus dem Tabellen-Attribut, aelteste zuerst, mit Kategorie und ohne Teaser', () => {
    const liste = parseListe(
      lies('aesch-uebersicht.html'),
      'iweb_tabelle',
      'https://www.aesch.bl.ch/aktuellesinformationen',
      HEUTE
    )
    expect(liste).toHaveLength(337)
    expect(liste[0]).toEqual({
      url: 'https://www.aesch.bl.ch/_rte/information/698576',
      titel: 'Parkieren nur in Fahrtrichtung erlaubt',
      teaser: null,
      datum: '2024-05-23',
      datumQuelle: 'liste',
      kategorie: 'news',
      direktPdf: false,
      veranstaltungAm: null,
      veranstaltungBis: null,
      zeit: null,
      lokalitaet: null,
      ort: null,
      veranstalter: null,
      serie: null,
      serieSeit: null,
      abgesagt: false
    })
    expect(liste[336]).toMatchObject({
      titel: 'Aus der Gemeinderatssitzung vom 08. September 2026',
      datum: '2026-09-11',
      kategorie: 'politik_info'
    })
    // The archive's oldest rows are dated, not unknown — an undated row is
    // what the run would otherwise count as unreadable.
    expect(liste.filter((e) => e.datum === null)).toHaveLength(0)
  })

  it('pratteln: das Datum kommt aus dem sichtbaren Text der Karte, nicht aus dem Attribut mit dem Jahr 2626', () => {
    const liste = parseListe(
      lies('pratteln-uebersicht.html'),
      'iweb_karten',
      'https://www.pratteln.ch/aktuellesinformationen',
      HEUTE
    )
    expect(liste).toHaveLength(12)
    expect(liste[0]).toMatchObject({
      url: 'https://www.pratteln.ch/_rte/information/2973976',
      titel: 'Verkehrsbehinderungen wegen Sicherheitsholzschlag',
      datum: '2026-09-14'
    })
    expect(liste[0]?.teaser).toMatch(/^Trockene und heisse Sommer/)
    expect(liste[11]?.datum).toBe('2026-08-04')
    expect(
      liste.every((e) => e.datum !== null && e.datum.startsWith('2026'))
    ).toBe(true)
  })
})

describe('Backslash', () => {
  it('binningen: absolute Links, echte Zeitstempel, Teaser', () => {
    const liste = parseListe(
      lies('binningen-uebersicht.html'),
      'backslash',
      'https://www.binningen.ch/de/gemeinde/news-und-medien/news.html/106',
      HEUTE
    )
    expect(liste).toHaveLength(33)
    expect(liste[0]).toMatchObject({
      url: 'https://www.binningen.ch/de/gemeinde/news-und-medien/news.html/106/news/6797',
      titel:
        'Jubiläumsglanzpunkt der Musikschule Binningen-Bottmingen: Abendblätter',
      datum: '2026-09-10',
      datumQuelle: 'liste'
    })
    expect(liste.slice(0, 3).every((e) => e.datum === '2026-09-10')).toBe(true)
    expect(liste[32]?.datum).toBe('2026-05-13')
  })
})

describe('parseListe — Nachbearbeitung', () => {
  const eintrag = (
    href: string,
    titel = 'Titel',
    datum = '01.09.2026'
  ): string =>
    `<li class="listEntry"><h3 class="listEntryTitle"><a href="${href}">${titel}</a></h3><div class="listEntryDate">${datum}</div></li>`

  it('wirft fremde Sites weg und zaehlt jede Adresse einmal', () => {
    const html =
      eintrag('/a.php') +
      eintrag('https://www.fremd.ch/b.php') +
      eintrag('/a.php', 'Doppelt')
    const liste = parseListe(
      html,
      'weblication',
      'https://www.example.ch/',
      HEUTE
    )
    expect(liste.map((e) => e.url)).toEqual(['https://www.example.ch/a.php'])
    expect(liste[0]?.titel).toBe('Titel')
  })

  it('misstraut einer Datumsspalte, die auf acht Eintraegen den heutigen Tag zeigt', () => {
    const html = Array.from({ length: KAPUTTE_SPALTE_AB }, (_, i) =>
      eintrag(`/${i}.php`, `T${i}`, '14.09.2026')
    ).join('')
    const liste = parseListe(
      html,
      'weblication',
      'https://www.example.ch/',
      HEUTE
    )
    expect(liste).toHaveLength(KAPUTTE_SPALTE_AB)
    expect(liste.every((e) => e.datum === null && e.datumQuelle === null)).toBe(
      true
    )
  })

  it('laesst wenige heutige Eintraege gelten — die kommen vor', () => {
    const html =
      eintrag('/1.php', 'A', '14.09.2026') +
      eintrag('/2.php', 'B', '14.09.2026')
    expect(
      parseListe(html, 'weblication', 'https://www.example.ch/', HEUTE).every(
        (e) => e.datum === '2026-09-14'
      )
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The events lists — same houses, same manners, dates that lie ahead
// ---------------------------------------------------------------------------

describe('Veranstaltungen', () => {
  // Weblication's event index prints its date in four different places across
  // the four sites; the title sits inside the anchor on three of them and
  // outside it on the fourth. One parser reads all four, and the iCal button
  // of every row is dropped before the title anchor is looked for — it is the
  // first anchor in the markup on two of the sites.
  it('allschwil: Datum im span, Titel im <b> der Verlinkung', () => {
    const liste = parseListe(
      lies('allschwil-veranstaltungen.html'),
      'weblication_termine',
      'https://www.allschwil.ch/de/veranstaltungen/',
      HEUTE
    )
    expect(liste).toHaveLength(5)
    expect(liste[0]).toMatchObject({
      url: 'https://www.allschwil.ch/de/veranstaltungen/detail/detail.php?i=12693987',
      titel: 'Einwohnerratssitzung',
      veranstaltungAm: '2026-10-13',
      datum: null,
      datumQuelle: null
    })
    expect(liste[0]?.teaser).toContain('18:00 Uhr')
  })

  it('reinach: das Datum steht blank im Listeneintrag, ohne eigenes Element', () => {
    const liste = parseListe(
      lies('reinach-veranstaltungen.html'),
      'weblication_termine',
      'https://www.reinach-bl.ch/de/veranstaltungen/',
      HEUTE
    )
    expect(liste.length).toBeGreaterThan(50)
    expect(liste[0]).toMatchObject({
      url: 'https://www.reinach-bl.ch/de/veranstaltungen/detail/detail.php?i=10970',
      titel: 'Frischwarenmarkt',
      veranstaltungAm: '2026-09-18'
    })
    expect(liste.every((e) => e.veranstaltungAm !== null)).toBe(true)
    expect(liste.every((e) => e.datum === null)).toBe(true)
  })

  it('bottmingen: Titel ausserhalb der Verlinkung, Datum in fullDate — das Kalender-Kaestchen ohne Jahr bleibt aussen vor', () => {
    const liste = parseListe(
      lies('bottmingen-veranstaltungen.html'),
      'weblication_termine',
      'https://www.bottmingen.ch/de/veranstaltungen/',
      HEUTE
    )
    expect(liste.length).toBeGreaterThan(20)
    expect(liste[0]).toMatchObject({
      url: 'https://www.bottmingen.ch/de/veranstaltungen/13013_freitags-treff',
      titel: 'Freitags Treff',
      veranstaltungAm: '2026-09-18'
    })
  })

  it('arlesheim: Datum im span INNERHALB des Titel-Ankers, Lokalitaet als Anriss', () => {
    const liste = parseListe(
      lies('arlesheim-veranstaltungen.html'),
      'weblication_termine',
      'https://www.arlesheim.ch/de/veranstaltungen/',
      HEUTE
    )
    expect(liste).toHaveLength(2)
    expect(liste[0]).toMatchObject({
      titel: 'Blaulichttag der Feuerwehr Birs',
      veranstaltungAm: '2026-09-19'
    })
    expect(liste[0]?.titel).not.toMatch(/\d{2}\.\d{2}\.\d{4}/)
    expect(liste[0]?.teaser).toContain('Lokalität')
  })

  it('aesch: i-web haengt den ganzen Anlasskalender als JSON an die Tabelle', () => {
    const liste = parseListe(
      lies('aesch-veranstaltungen.html'),
      'iweb_termine',
      'https://www.aesch.bl.ch/anlaesseaktuelles',
      HEUTE
    )
    expect(liste).toHaveLength(21)
    expect(liste[0]).toMatchObject({
      url: 'https://www.aesch.bl.ch/_rte/anlass/7522045',
      titel: 'Repair Kaffi',
      veranstaltungAm: '2026-10-17',
      datum: null
    })
    expect(liste[0]?.teaser).toContain('Früschmärt-Platz')
    // The municipality's own collection dates ride in this list too — which is
    // exactly what the waste cross-check the Sichtung already runs is for.
    expect(liste.some((e) => /Grünabfuhr|Häckseldienst/.test(e.titel))).toBe(
      true
    )
  })

  it('binningen: Backslash druckt hCalendar, dtstart ist der Termin', () => {
    const liste = parseListe(
      lies('binningen-veranstaltungen.html'),
      'backslash_termine',
      'https://www.binningen.ch/de/gemeinde/news-und-medien/veranstaltungen.html/51',
      HEUTE
    )
    expect(liste.length).toBeGreaterThan(100)
    expect(liste[0]).toMatchObject({
      titel: 'Kiki die Kinderkirche 2026',
      veranstaltungAm: '2026-02-08',
      datum: null
    })
    expect(liste.every((e) => e.veranstaltungAm !== null)).toBe(true)
  })

  // What the row says about WHEN and WHERE, beyond the day: the Anlass model
  // groups rows into series on venue and time, and a span's last day is what
  // keeps a running exhibition in the window until it ends.
  it('liest Uhrzeit und Spanne aus der Weblication-Zeile', () => {
    const allschwil = parseListe(
      lies('allschwil-veranstaltungen.html'),
      'weblication_termine',
      'https://www.allschwil.ch/de/veranstaltungen/',
      HEUTE
    )
    expect(allschwil[0]).toMatchObject({
      veranstaltungAm: '2026-10-13',
      veranstaltungBis: null,
      zeit: '18:00–21:00'
    })
    const reinach = parseListe(
      lies('reinach-veranstaltungen.html'),
      'weblication_termine',
      'https://www.reinach-bl.ch/de/veranstaltungen/',
      HEUTE
    )
    expect(reinach.find((e) => e.titel === 'Gnuss uf em Platz')).toMatchObject({
      veranstaltungAm: '2026-09-18',
      veranstaltungBis: '2026-09-19',
      zeit: '15:00–23:45'
    })
    const arlesheim = parseListe(
      lies('arlesheim-veranstaltungen.html'),
      'weblication_termine',
      'https://www.arlesheim.ch/de/veranstaltungen/',
      HEUTE
    )
    expect(arlesheim[0]?.lokalitaet).toBe(
      'Feuerwehrmagazin Birs Wache 24 / Arlesheim'
    )
  })

  it('bottmingen: eine abgesagte Boerse sagt es im Titel', () => {
    const liste = parseListe(
      lies('bottmingen-veranstaltungen.html'),
      'weblication_termine',
      'https://www.bottmingen.ch/de/veranstaltungen/',
      HEUTE
    )
    const abgesagt = liste.filter((e) => e.abgesagt)
    expect(abgesagt.length).toBeGreaterThan(0)
    expect(abgesagt[0]?.titel).toMatch(/abgesagt/)
    expect(liste[0]?.abgesagt).toBe(false)
  })

  it('i-web: Spanne, Zeit, Lokalitaet, Ort, Veranstalter und Kategorie sind Felder', () => {
    const pratteln = parseListe(
      lies('pratteln-veranstaltungen.html'),
      'iweb_termine',
      'https://www.pratteln.ch/anlaesseaktuelles',
      HEUTE
    )
    expect(pratteln).toHaveLength(47)
    expect(pratteln.find((e) => e.titel === 'Markt des Alterns')).toMatchObject(
      {
        veranstaltungAm: '2026-09-25',
        veranstaltungBis: null,
        zeit: '13:00–18:00',
        lokalitaet: 'Kultur- und Sportzentrum',
        ort: 'Pratteln',
        veranstalter: 'Gemeinde Pratteln',
        kategorie: '3,26'
      }
    )
    // A running exhibition is ONE row with a span, not a row per day.
    expect(pratteln.find((e) => /Alder & Bahn/.test(e.titel))).toMatchObject({
      veranstaltungAm: '2026-08-10',
      veranstaltungBis: '2027-03-21'
    })
    const aesch = parseListe(
      lies('aesch-veranstaltungen.html'),
      'iweb_termine',
      'https://www.aesch.bl.ch/anlaesseaktuelles',
      HEUTE
    )
    expect(
      aesch.find((e) => e.titel === 'Aescher Weihnachtsmarkt')
    ).toMatchObject({
      veranstaltungAm: '2026-11-27',
      veranstaltungBis: '2026-11-29',
      veranstalter: 'Verein Attraktives Aesch'
    })
  })

  it('muttenz und muenchenstein: Ausfall im Titel, Spanne einer Laufgruppe', () => {
    const muttenz = parseListe(
      lies('muttenz-veranstaltungen.html'),
      'iweb_termine',
      'https://www.muttenz.ch/anlass',
      HEUTE
    )
    expect(muttenz).toHaveLength(53)
    expect(
      muttenz.find((e) => e.titel === 'Gemeindeversammlung findet nicht statt')
    ).toMatchObject({ abgesagt: true, veranstaltungAm: '2026-10-15' })
    const muenchenstein = parseListe(
      lies('muenchenstein-veranstaltungen.html'),
      'iweb_termine',
      'https://www.muenchenstein.ch/anlaesseaktuelles',
      HEUTE
    )
    expect(muenchenstein).toHaveLength(63)
    expect(muenchenstein.find((e) => /Laufgruppe/.test(e.titel))).toMatchObject(
      {
        veranstaltungAm: '2026-05-07',
        veranstaltungBis: '2026-12-17',
        veranstalter: 'Koordinationsstelle für das Alter und der Seniorenrat'
      }
    )
  })

  it('binningen: die Adresse traegt die Serie, dtend die Spanne, das dtstart-Attribut den Serienstart', () => {
    const liste = parseListe(
      lies('binningen-veranstaltungen.html'),
      'backslash_termine',
      'https://www.binningen.ch/de/gemeinde/news-und-medien/veranstaltungen.html/51',
      HEUTE
    )
    expect(liste[0]).toMatchObject({
      titel: 'Kiki die Kinderkirche 2026',
      veranstaltungAm: '2026-02-08',
      veranstaltungBis: '2026-12-06',
      serie: '8364'
    })
    const sitzungen = liste.filter((e) => e.titel === 'Einwohnerratssitzung')
    expect(sitzungen.length).toBeGreaterThan(1)
    expect(sitzungen[0]).toMatchObject({
      veranstaltungAm: '2026-09-21',
      serie: '2648',
      serieSeit: '2022-04-04'
    })
    expect(new Set(sitzungen.map((e) => e.serie)).size).toBe(1)
  })

  it('zeitText und parseTerminZeile normalisieren, was die Seiten drucken', () => {
    expect(zeitText('13.00 Uhr - 18.00 Uhr')).toBe('13:00–18:00')
    expect(zeitText('19.00 Uhr')).toBe('19:00')
    expect(zeitText('9:30 – 10:15')).toBe('09:30–10:15')
    expect(zeitText('60 Minuten')).toBeNull()
    // A price is not a time, and a date's day and month are not one either.
    expect(zeitText('CHF 20.00')).toBeNull()
    expect(zeitText('18.09.2026')).toBeNull()
    expect(
      parseTerminZeile('18.09.2026 | 15:00 Uhr - 19.09.2026 | 23:45 Uhr', HEUTE)
    ).toEqual({ von: '2026-09-18', bis: '2026-09-19', zeit: '15:00–23:45' })
    expect(parseTerminZeile('13. Oktober 2026, 18:00 Uhr', HEUTE)).toEqual({
      von: '2026-10-13',
      bis: null,
      zeit: '18:00'
    })
    expect(istAbgesagt('ABGESAGT: Die eigene Scholle')).toBe(true)
    expect(istAbgesagt('Die Führung wurde verschoben')).toBe(true)
    expect(istAbgesagt('Absage-Regelung siehe Flyer')).toBe(false)
  })

  it('traegt auf Nachrichtenlisten kein Veranstaltungsdatum ein', () => {
    const liste = parseListe(
      lies('binningen-uebersicht.html'),
      'backslash',
      'https://www.binningen.ch/de/gemeinde/news-und-medien/news.html/106',
      HEUTE
    )
    expect(liste.every((e) => e.veranstaltungAm === null)).toBe(true)
  })
})

describe('oderNull', () => {
  // Gemessen am ersten Lauf (20.09.2026): Arlesheim schreibt „Lokalität: -"
  // in Eintraege, deren Ort es nicht fuehrt. Der Strich kam als Ort durch —
  // auf dem Tisch als Ort „-", und im Serienschluessel als ein ANDERER Ort,
  // was dieselbe Ausstellung in zwei Anlaesse zerlegte.
  it('nimmt einen Wert ohne Buchstabe und ohne Ziffer nicht als Angabe', () => {
    expect(oderNull('-')).toBeNull()
    expect(oderNull('–')).toBeNull()
    expect(oderNull('. . .')).toBeNull()
    expect(oderNull('')).toBeNull()
    expect(oderNull('Trotte')).toBe('Trotte')
    expect(oderNull('Saal 1')).toBe('Saal 1')
  })
})
