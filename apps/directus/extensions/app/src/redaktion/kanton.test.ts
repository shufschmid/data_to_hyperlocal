import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDetail } from '../shared/kanton/api'
import {
  attributionsWarnung,
  aufraeumAktionKanton,
  buildKantonPrompt,
  buildKantonSichtungPrompt,
  KANTON_MELDUNG_SYSTEM_PROMPT,
  mitQuelle,
  namensKandidaten,
  ohneQuelle,
  polizeiPersonenWarnungen,
  quelleZeile,
  vorfilter,
  zahlWarnungen,
  type KantonFakten
} from './kanton'

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      join(__dirname, '..', 'shared', 'kanton', 'fixtures', name),
      'utf8'
    )
  )

const GEMEINDEN = [
  { id: 'g-aesch', name: 'Aesch' },
  { id: 'g-muenchenstein', name: 'Münchenstein' },
  { id: 'g-reinach', name: 'Reinach' },
  { id: 'g-riehen', name: 'Riehen' }
]

describe('vorfilter — wer genannt ist, entscheidet der Code', () => {
  it('trifft mit Wortgrenzen: Aeschenplatz ist nicht Aesch, Buus BL trifft nichts', () => {
    expect(
      vorfilter(
        {
          titel: 'Unfall am Aeschenplatz',
          teaser: null,
          text: 'Am Riehenring …'
        },
        GEMEINDEN
      )
    ).toEqual([])
    expect(
      vorfilter(
        {
          titel: 'Brand in Scheunenanbau',
          teaser: 'auf einem Hof im Grien in Buus BL',
          text: null
        },
        GEMEINDEN
      )
    ).toEqual([])
  })

  it('nimmt aus «Münchenstein und Birsfelden» nur die bespielte Gemeinde, aus dem Text auch', () => {
    const d = parseDetail(fixture('medienmitteilung-tempo30.json'))
    expect(
      vorfilter(
        { titel: d.titel ?? '', teaser: d.teaser, text: d.text },
        GEMEINDEN
      )
    ).toEqual([{ id: 'g-muenchenstein', name: 'Münchenstein' }])
    expect(
      vorfilter(
        {
          titel: 'Lieferwagen gerät in Brand',
          teaser: 'Auf der Strecke von Aesch nach Reinach',
          text: null
        },
        GEMEINDEN
      )
    ).toEqual([
      { id: 'g-aesch', name: 'Aesch' },
      { id: 'g-reinach', name: 'Reinach' }
    ])
  })
})

describe('buildKantonSichtungPrompt', () => {
  it('nennt Art, Behörde, Datum und die weiteren Gemeinden', () => {
    const prompt = buildKantonSichtungPrompt(
      'Münchenstein',
      [
        {
          id: 'k1',
          titel: 'Tempo-30-Anträgen wird teilweise zugestimmt',
          auszug: 'Die SID und die BUD haben die Anträge geprüft.',
          publiziertAm: '2026-09-02',
          quelle: 'medienmitteilung',
          behoerde: 'Sicherheitsdirektion',
          weitereGemeinden: ['Birsfelden'],
          textAbgeschnitten: false
        }
      ],
      '',
      'Regeln der Redaktion:\nR1 …'
    )
    expect(prompt).toContain(
      '1. [Medienmitteilung · Sicherheitsdirektion · 2. September 2026] "Tempo-30-Anträgen'
    )
    expect(prompt).toContain(
      '(nennt auch Birsfelden — beurteile nur den Bezug zu Münchenstein)'
    )
    expect(prompt).toContain('R1 …')
    expect(prompt).toContain('Beurteile alle 1')
  })
})

describe('aufraeumAktionKanton — die zwei Regeln des Gemeindetischs, ohne Termin', () => {
  const zeile = {
    id: 'k',
    entscheid: 'offen',
    vorschlag: null,
    publiziert_am: '2026-09-01',
    date_created: null
  }
  it('löscht Unvorgeschlagenes nach sieben Tagen, lässt Vorschläge vierzehn verfallen', () => {
    expect(aufraeumAktionKanton(zeile, '2026-09-09')).toBe('loeschen')
    expect(
      aufraeumAktionKanton({ ...zeile, vorschlag: true }, '2026-09-09')
    ).toBeNull()
    expect(
      aufraeumAktionKanton({ ...zeile, vorschlag: true }, '2026-09-16')
    ).toBe('verfallen')
    expect(
      aufraeumAktionKanton({ ...zeile, entscheid: 'uebernommen' }, '2026-10-16')
    ).toBeNull()
  })
})

const fakten = (ueber: Partial<KantonFakten> = {}): KantonFakten => ({
  gemeinde: 'Münchenstein',
  quelle: 'medienmitteilung',
  quelleName: 'Kanton Basel-Landschaft',
  behoerde: 'Sicherheitsdirektion',
  titel:
    'Tempo-30-Anträgen in Münchenstein und Birsfelden wird teilweise zugestimmt',
  teaser: null,
  publiziertAm: '2026-09-02',
  text: 'Die Sicherheitsdirektion hat die Anträge geprüft. Auf der Hauptstrasse gilt ab 1. November 2026 Tempo 30 auf 440 Metern.',
  textAbgeschnitten: false,
  url: 'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30',
  weitereGemeinden: ['Birsfelden'],
  datenImText: ['2026-11-01'],
  ...ueber
})

describe('die Meldung — Prompt, Quellenzeile, Checks', () => {
  it('der Prompt nennt Sprecher, Behörde, weitere Gemeinden und die gefundenen Tage', () => {
    const p = buildKantonPrompt(fakten(), ['Der Bibo heisst der Bibo.'])
    expect(p).toContain(
      'Medienmitteilung — Kanton Basel-Landschaft (Sicherheitsdirektion) vom 2. September 2026'
    )
    expect(p).toContain(
      'nennt auch Birsfelden — die Meldung ist fuer Münchenstein'
    )
    expect(p).toContain('2026-11-01')
    expect(p).toContain('Der Bibo heisst der Bibo.')
    expect(KANTON_MELDUNG_SYSTEM_PROMPT).toContain('nie ueber eine\n  Person')
  })

  it('baut die Quellenzeile je Sprecher und nimmt sie fuer die Revision wieder ab', () => {
    expect(quelleZeile(fakten())).toBe(
      'Quelle: Medienmitteilung des Kantons Basel-Landschaft (Sicherheitsdirektion) vom 2. September 2026, https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/medienmitteilungen/tempo-30'
    )
    const polizei = fakten({
      quelle: 'polizeimeldung',
      quelleName: 'Polizei Basel-Landschaft',
      behoerde: 'Polizei Basel-Landschaft',
      url: 'https://www.baselland.ch/p'
    })
    expect(quelleZeile(polizei)).toBe(
      'Quelle: Polizeimeldung der Polizei Basel-Landschaft vom 2. September 2026, https://www.baselland.ch/p'
    )
    expect(ohneQuelle(mitQuelle('Text.', polizei))).toBe('Text.')
  })

  it('verlangt den Sprecher als Quelle — den Kanton oder die Polizei', () => {
    expect(
      attributionsWarnung(
        'Wie der Kanton Basel-Landschaft mitteilt, gilt Tempo 30.',
        fakten()
      )
    ).toBeNull()
    expect(
      attributionsWarnung(
        'Laut der Sicherheitsdirektion des Kantons Basel-Landschaft gilt Tempo 30.',
        fakten()
      )
    ).toBeNull()
    expect(
      attributionsWarnung('In Münchenstein gilt bald Tempo 30.', fakten())
    ).toMatch(/nennt Kanton Basel-Landschaft nicht/)
    const polizei = fakten({
      quelle: 'polizeimeldung',
      quelleName: 'Polizei Basel-Landschaft'
    })
    expect(
      attributionsWarnung(
        'Wie die Polizei Basel-Landschaft mitteilt, brannte eine Scheune.',
        polizei
      )
    ).toBeNull()
    expect(
      attributionsWarnung(
        'Wie der Kanton Basel-Landschaft mitteilt, brannte eine Scheune.',
        polizei
      )
    ).toMatch(/nennt Polizei Basel-Landschaft nicht/)
    expect(
      attributionsWarnung('Die Polizei Basel-Landschaft war vor Ort.', polizei)
    ).toMatch(/sagt nicht/)
  })

  it('meldet Ziffern, die nicht in den Angaben stehen', () => {
    expect(
      zahlWarnungen('Tempo 30 auf 440 Metern ab 1. November 2026.', fakten())
    ).toEqual([])
    expect(zahlWarnungen('Tempo 30 auf 500 Metern.', fakten())).toEqual([
      'Zahl "500" steht nicht in den Angaben.'
    ])
  })
})

describe('Personen in Polizeimeldungen — eine Heuristik, als solche erklaert', () => {
  it('findet im echten Buus-Text keinen Namen', () => {
    const d = parseDetail(fixture('polizeimeldung-buus.json'))
    expect(namensKandidaten(d.text, ['Buus'])).toEqual([])
  })

  it('findet einen Namen und warnt, wenn die Meldung ihn wiederholt', () => {
    const quelltext =
      'Am Mittwoch, 23. September 2026, wurde Max Muster zuletzt in Reinach gesehen. Die Polizei Basel-Landschaft bittet um Hinweise. Der Vermisste trug eine Jacke.'
    expect(namensKandidaten(quelltext, ['Reinach'])).toEqual(['Max Muster'])
    const f = fakten({
      quelle: 'polizeimeldung',
      quelleName: 'Polizei Basel-Landschaft',
      gemeinde: 'Reinach',
      weitereGemeinden: [],
      text: quelltext
    })
    expect(
      polizeiPersonenWarnungen(
        'Wie die Polizei mitteilt, wird Max Muster vermisst.',
        f
      )
    ).toHaveLength(1)
    expect(
      polizeiPersonenWarnungen(
        'Wie die Polizei mitteilt, wird ein Mann vermisst.',
        f
      )
    ).toEqual([])
  })

  it('haelt Satzanfaenge, Wochentage, Behoerden und Strassen nie fuer Namen — und prueft Medienmitteilungen nicht', () => {
    expect(
      namensKandidaten(
        'Am Mittwoch brannte es. Die Polizei kam. Beim Löschversuch half die Feuerwehr Sissach. Die Hauptstrasse Lampenberg war gesperrt.',
        []
      )
    ).toEqual([])
    expect(
      polizeiPersonenWarnungen(
        'Max Muster',
        fakten({ text: 'Max Muster sagt etwas.' })
      )
    ).toEqual([])
  })
})
