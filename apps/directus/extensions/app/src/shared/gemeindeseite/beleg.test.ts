import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  falschGelesen,
  HINWEIS_NUR_ANRISS,
  modulAdresse,
  traegtAnriss
} from './beleg'
import { parseDetail } from './detail'

const lies = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')
const HEUTE = { jahr: 2026, monat: 9, tag: 28 }

// Gemessen am 28.09.2026: Binningens News-Liste fuehrt die Baustellen-
// information mit diesem Anriss, verlinkt aber die Seite aller Baustellen.
const ANRISS =
  'Für die Verlegearbeiten des Primeo Stromtrasse quer vor dem Ausfahrtsbereich Fuchshagweg, muss die Ausfahrt am Freitag, 2. Oktober 2026, von 07.30 bis 17.00 Uhr für sämtliche Fahrzeuge inkl. Velos gesperrt werden.'
const LISTE =
  'https://www.binningen.ch/de/gemeinde/news-und-medien/news.html/106'
const VERLINKT =
  'https://www.binningen.ch/de/dienstleistungen/bauen-und-ortsplanung/baustelleninformationen.html/717/news/6819'

describe('traegtAnriss — die Detailseite muss die Mitteilung zeigen', () => {
  it('verwirft die Uebersicht aller Baustellen, die die Liste verlinkt', () => {
    const d = parseDetail(
      lies('binningen-baustellen-uebersicht.html'),
      'backslash',
      VERLINKT,
      HEUTE
    )
    expect(d.text.length).toBeGreaterThan(5000)
    expect(traegtAnriss(d, ANRISS)).toBe(false)
  })

  it('erkennt die eigene Seite der Mitteilung', () => {
    const d = parseDetail(
      lies('binningen-baustelle-6819.html'),
      'backslash',
      `${LISTE}/news/6819`,
      HEUTE
    )
    expect(traegtAnriss(d, ANRISS)).toBe(true)
  })

  it('prueft nichts, wo die Liste keinen oder einen zu kurzen Anriss hat', () => {
    expect(traegtAnriss({ titel: 'x', lead: null, text: 'y' }, null)).toBeNull()
    expect(
      traegtAnriss({ titel: 'x', lead: null, text: 'y' }, 'Mehr erfahren')
    ).toBeNull()
  })

  it('liest ueber Satzzeichen, Gross- und Kleinschreibung hinweg', () => {
    expect(
      traegtAnriss(
        {
          titel: null,
          lead: 'FÜR DIE Verlegearbeiten, des Primeo-Stromtrasse quer vor dem Ausfahrtsbereich …',
          text: ''
        },
        ANRISS
      )
    ).toBe(true)
  })
})

describe('modulAdresse — Backslash zeigt jede Mitteilung unter der Liste', () => {
  it('fuehrt eine fremd verlinkte Mitteilung auf die Adresse der Liste', () => {
    expect(modulAdresse(LISTE, VERLINKT)).toBe(`${LISTE}/news/6819`)
  })

  it('laesst eine Mitteilung, die schon unter der Liste liegt, und einen Link ohne Nummer', () => {
    expect(modulAdresse(LISTE, `${LISTE}/news/6797`)).toBeNull()
    expect(
      modulAdresse(
        LISTE,
        'https://www.binningen.ch/de/gemeinde/politik/einwohnerrat/sitzungen/die-sitzungen-im-jahr-2026.html/1329'
      )
    ).toBeNull()
    expect(
      modulAdresse('https://www.example.ch/aktuelles', VERLINKT)
    ).toBeNull()
  })
})

describe('falschGelesen — Zeilen vor dieser Pruefung', () => {
  it('erkennt eine Zeile, deren Text ihren Anriss nicht traegt', () => {
    expect(
      falschGelesen({
        titel: 'Baustelleninformation',
        teaser: ANRISS,
        text: 'Margarethentalbrücke, Postgasse, Neuweilerplatz und zwölf weitere Baustellen.',
        hinweise: null
      })
    ).toBe(true)
  })

  it('laesst eine richtig gelesene und eine bewusst nur mit Anriss gespeicherte Zeile in Ruhe', () => {
    expect(
      falschGelesen({
        titel: 'Baustelleninformation',
        teaser: ANRISS,
        text: ANRISS,
        hinweise: null
      })
    ).toBe(false)
    expect(
      falschGelesen({
        titel: 'x',
        teaser: ANRISS,
        text: 'etwas',
        hinweise: [HINWEIS_NUR_ANRISS]
      })
    ).toBe(false)
    expect(
      falschGelesen({ titel: 'x', teaser: null, text: 'etwas', hinweise: null })
    ).toBe(false)
  })
})
