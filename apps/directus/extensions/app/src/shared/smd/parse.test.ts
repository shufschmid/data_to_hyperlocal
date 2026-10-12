import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  istAutorZeile,
  kopfteile,
  normiereTitel,
  parseBlogEintraege,
  parseDossier,
  parseInhaltsverzeichnis
} from './parse'

const seiten = (): string[] =>
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'dossier-2026-10-11.json'), 'utf8')
  ) as string[]

describe('parseDossier — das Inhaltsverzeichnis schneidet die Dokumente', () => {
  const lesung = parseDossier(seiten())

  it('liest das Titelblatt und vier Dokumente mit ihren Seitenbereichen', () => {
    expect(lesung.kopf).toEqual({
      erstelltAm: '2026-10-11',
      anzahlDokumente: 4
    })
    expect(lesung.dokumente).toHaveLength(4)
    expect(lesung.dokumente.map((d) => [d.seiteVon, d.seiteBis])).toEqual([
      [2, 4],
      [5, 5],
      [6, 6],
      [7, 7]
    ])
    expect(lesung.hinweise).toEqual([])
  })

  it('nimmt das Medium vom Seitenkopf, den Titel aus dem Verzeichnis — auch ueber zwei Zeilen', () => {
    const [blog, kurve, volley, museum] = lesung.dokumente
    expect(blog?.medium).toBe('bzbasel.ch')
    expect(volley?.medium).toBe('bazonline.ch')
    expect(volley?.titel).toBe(
      "Volleyball: Sm'Aesch Pfeffingen startet mit einem Arbeitssieg in die Saison"
    )
    expect(museum?.titel).toBe(
      'Früher strömten 1000 junge Leute ins Schloss – heute fehlen sie dem Museum'
    )
    expect(museum?.datum).toBe('2026-10-10')
    expect(kurve?.datum).toBe('2026-10-11')
  })

  it('liest Rubrik, Lead und Autorin vom Seitenanfang und laesst Titelzeilen, Kopf und Fuss aus dem Text', () => {
    const [, kurve, volley] = lesung.dokumente
    expect(kurve?.rubrik).toBe('Pratteln')
    expect(kurve?.lead).toBe(
      'Die Autobahnausfahrt in Pratteln endete für einen 26-jährigen Autofahrer nicht auf der Strasse, sondern auf einer Wiese: Der Mann fuhr in einer Rechtskurve geradeaus, prallte gegen einen Kandelaber und kam erst auf der Salinenstrasse zum Stillstand.'
    )
    expect(kurve?.autor).toBeNull()
    expect(kurve?.text).not.toMatch(/^Kurve verpasst/)
    expect(kurve?.text).not.toMatch(/Dossier - Bello Bajour/)
    expect(kurve?.text).not.toMatch(/©/)
    expect(kurve?.text).toMatch(/0,87 Milligramm/)
    expect(kurve?.blog).toBeNull()

    expect(volley?.rubrik).toBe('Sport')
    expect(volley?.lead).toBe(
      'Die verletzungsgeschwächten Baselbieterinnen ringen Aufsteiger Aarau in fünf Sätzen nieder.'
    )
    expect(volley?.autor).toBe('Nils Løvold')
  })

  it('erkennt den Blog an seinen Eintraegen: drei, mit Tag, Zeit und Titel ueber zwei Zeilen', () => {
    const blog = lesung.dokumente[0]?.blog
    expect(blog?.name).toBe('Regiosport-Aktuell')
    expect(blog?.eintraege.map((e) => [e.datum, e.zeit, e.titel])).toEqual([
      ['2026-10-10', '22:28', 'Sm’Aesch lässt in Aarau einen Punkt liegen'],
      [
        '2026-10-08',
        '07:42',
        'RTV Basel bezwingt Solothurn und zieht ins Achtelfinale ein'
      ],
      ['2026-06-10', '11:35', 'Marcell Révész unterschreibt beim EHC Basel']
    ])
    const erster = blog?.eintraege[0]
    expect(erster?.text).toMatch(/^Romina Schnyder/)
    expect(erster?.text).toMatch(/Aarau – Sm’Aesch Pfeffingen 2:3\./)
    // The Starwings piece carries no timestamp of its own in this cut and
    // therefore belongs to the entry before it — nothing is dropped.
    expect(erster?.text).toMatch(/Die Starwings verlieren in Neuenburg/)
    expect(erster?.text).not.toMatch(/Dossier - Bello/)
    // A page break between the timestamp and the title (footer, header) does not split the entry.
    expect(blog?.eintraege[1]?.text).toMatch(/^Handball Der RTV/)
    expect(lesung.dokumente[0]?.lead).toBe(
      'Mit dem Blog «Regiosport-Aktuell» sind Sie jederzeit informiert, was die Teams und die Einzelsportler aus der Region aktuell leisten.'
    )
    expect(lesung.dokumente[0]?.autor).toBe('bz-Sportredaktion')
  })

  it('sagt, wenn das Titelblatt eine andere Zahl nennt als das Verzeichnis, und wenn eine Seite fehlt', () => {
    const s = seiten()
    s[0] = s[0]!.replace('Anzahl Dokumente 4', 'Anzahl Dokumente 7')
    const l = parseDossier(s.slice(0, 6))
    expect(l.hinweise).toContain(
      'Das Titelblatt nennt 7 Dokumente, das Inhaltsverzeichnis 4'
    )
    expect(l.dokumente).toHaveLength(3)
    expect(l.hinweise.some((h) => h.includes('nennt Seite 7'))).toBe(true)
  })

  it('bleibt ruhig ohne Inhaltsverzeichnis', () => {
    const l = parseDossier(['Irgendein PDF', 'ohne Verzeichnis'])
    expect(l.dokumente).toEqual([])
    expect(l.hinweise[0]).toMatch(/Kein Inhaltsverzeichnis/)
  })
})

describe('parseInhaltsverzeichnis', () => {
  it('liest eine Zeile ohne Leerzeichen vor der Seitenzahl und eine mit', () => {
    expect(
      parseInhaltsverzeichnis([
        'Inhaltsverzeichnis',
        '10-10-2026 bazonline.ch Restaurant Waldrain: Die Düster Brüder haben eine Spitzenlage............ 42',
        '10-10-2026 bzbasel.ch Früher strömten 1000 junge Leute ins Schloss – heute fehlen sie dem Museum...........41'
      ])
    ).toEqual([
      {
        datum: '2026-10-10',
        text: 'bazonline.ch Restaurant Waldrain: Die Düster Brüder haben eine Spitzenlage',
        seite: 42
      },
      {
        datum: '2026-10-10',
        text: 'bzbasel.ch Früher strömten 1000 junge Leute ins Schloss – heute fehlen sie dem Museum',
        seite: 41
      }
    ])
  })
})

describe('parseBlogEintraege', () => {
  it('nimmt den Wochentag vor dem Datum und loest das Jahr am Dossierdatum auf', () => {
    const e = parseBlogEintraege(
      [
        '13:24 Uhr',
        'Mittwoch, 7. Oktober',
        'Über 3200 Peptid-Fläschchen',
        'Text.',
        '16:30 Uhr',
        '20. Dezember',
        'Alt',
        'Text.'
      ],
      '2026-01-05'
    )
    expect(e.map((x) => x.datum)).toEqual(['2025-10-07', '2025-12-20'])
    expect(e[0]?.titel).toBe('Über 3200 Peptid-Fläschchen')
  })

  it('haelt eine Titelzeile nicht fuer den Anfang des Textes', () => {
    const e = parseBlogEintraege(
      [
        '08:00 Uhr',
        '1. Mai',
        'Kurz',
        'Der lange Textabsatz beginnt hier und reicht weit über die Grenze hinaus. (sda)',
        '09:00 Uhr',
        '2. Mai',
        'Zweiter'
      ],
      '2026-05-03'
    )
    expect(e[0]?.titel).toBe('Kurz')
    expect(e[0]?.text).toMatch(/^Der lange/)
  })
})

describe('kopfteile und istAutorZeile', () => {
  it('kennt Bylines und verwechselt sie nicht mit Text', () => {
    expect(istAutorZeile('Nils Løvold')).toBe(true)
    expect(istAutorZeile('bz-Sportredaktion')).toBe(true)
    expect(istAutorZeile('Salome Halbeisen')).toBe(true)
    expect(istAutorZeile('Saison')).toBe(false)
    expect(istAutorZeile('Der Lenker blieb unverletzt.')).toBe(false)
    expect(istAutorZeile('Bild: Roland Schmid')).toBe(false)
  })

  it('nimmt den Lead bis zur Byline, sonst bis zum Satzende, sonst nichts', () => {
    expect(
      kopfteile(['Ein Satz.', 'Noch einer.', 'Anna Muster', 'Text'])
    ).toEqual({
      lead: 'Ein Satz. Noch einer.',
      autor: 'Anna Muster'
    })
    expect(
      kopfteile(['Ein langer', 'Satz.', 'Weiter geht es im Text.'])
    ).toEqual({
      lead: 'Ein langer Satz.',
      autor: null
    })
    expect(kopfteile(['RAUM BASEL', 'Mi, 14.10.'])).toEqual({
      lead: null,
      autor: null
    })
  })
})

describe('normiereTitel', () => {
  it('macht aus zwei Schreibweisen eine', () => {
    expect(normiereTitel("Sm'Aesch gewinnt – 3'200 Fläschchen")).toBe(
      normiereTitel('Sm’Aesch gewinnt — 3200 Fläschchen')
    )
  })
})
