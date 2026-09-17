import { describe, expect, it } from 'vitest'
import {
  bestimmeDatum,
  fensterSeit,
  kandidaten,
  ohneDatumHinweis,
  waehleZuLesen,
  zeileAus,
  type Anhang
} from './auswahl'
import type { DetailInhalt } from './detail'
import type { ListenEintrag } from './liste'

const eintrag = (
  url: string,
  datum: string | null,
  datumQuelle: ListenEintrag['datumQuelle'] = datum === null ? null : 'liste'
): ListenEintrag => ({
  url: `https://www.example.ch/${url}`,
  titel: url,
  teaser: null,
  datum,
  datumQuelle,
  kategorie: null,
  direktPdf: false
})

const detail = (ueber: Partial<DetailInhalt> = {}): DetailInhalt => ({
  titel: 'Detailtitel',
  datum: null,
  lead: null,
  text: 'Ein Absatz.\n\nNoch einer.',
  dokumente: [],
  kanonisch: null,
  verfahren: 'weblication',
  ...ueber
})

describe('fensterSeit', () => {
  it('sieben Tage beim ersten Lauf, drei danach', () => {
    expect(fensterSeit('2026-09-14', true)).toBe('2026-09-07')
    expect(fensterSeit('2026-09-14', false)).toBe('2026-09-11')
    expect(fensterSeit('2026-09-14', false, 5)).toBe('2026-09-09')
  })
})

describe('kandidaten', () => {
  const liste = [
    eintrag('neu', '2026-09-13'),
    eintrag('alt', '2026-08-01'),
    eintrag('ohne', null)
  ]

  it('nimmt Datierte im Fenster; Undatierte werden gezaehlt, nie geoeffnet', () => {
    expect(kandidaten(liste, '2026-09-11')).toEqual({
      drin: [liste[0]],
      undatiert: [liste[2]]
    })
    expect(kandidaten(liste, '2026-08-01')).toEqual({
      drin: [liste[0], liste[1]],
      undatiert: [liste[2]]
    })
  })

  it('nennt Undatierte auf der Statuszeile beim Titel, hoechstens drei, den Rest gezaehlt', () => {
    expect(ohneDatumHinweis([eintrag('Geschwindigkeitsmessungen', null)])).toBe(
      'Kein Eintrag trägt ein erkennbares Datum — nichts gelesen: «Geschwindigkeitsmessungen»'
    )
    expect(
      ohneDatumHinweis(['a', 'b', 'c', 'd', 'e'].map((t) => eintrag(t, null)))
    ).toBe(
      'Kein Eintrag trägt ein erkennbares Datum — nichts gelesen: «a», «b», «c» (+2 weitere)'
    )
  })
})

describe('waehleZuLesen', () => {
  it('neueste zuerst, Undatierte zuletzt, der Rest wird gezaehlt', () => {
    const liste = [
      eintrag('ohne', null),
      eintrag('a', '2026-09-10'),
      eintrag('b', '2026-09-13'),
      eintrag('c', '2026-09-12')
    ]
    const { zuLesen, nichtGelesen } = waehleZuLesen(liste, 3)
    expect(zuLesen.map((e) => e.titel)).toEqual(['b', 'c', 'a'])
    expect(nichtGelesen).toBe(1)
  })
})

describe('bestimmeDatum', () => {
  it('ein volles Detaildatum schlaegt ein aus dem Kalender abgeleitetes', () => {
    expect(
      bestimmeDatum(eintrag('x', '2026-09-10', 'kalender'), '2026-09-11')
    ).toEqual({ datum: '2026-09-11', quelle: 'detail' })
  })

  it('sonst steht das Listendatum, dann das Detaildatum, dann nichts', () => {
    expect(bestimmeDatum(eintrag('x', '2026-09-10'), '2026-09-11')).toEqual({
      datum: '2026-09-10',
      quelle: 'liste'
    })
    expect(bestimmeDatum(eintrag('x', '2026-09-10', 'kalender'), null)).toEqual(
      { datum: '2026-09-10', quelle: 'kalender' }
    )
    expect(bestimmeDatum(eintrag('x', null), '2026-09-11')).toEqual({
      datum: '2026-09-11',
      quelle: 'detail'
    })
    expect(bestimmeDatum(eintrag('x', null), null)).toEqual({
      datum: null,
      quelle: 'keins'
    })
  })
})

describe('zeileAus', () => {
  const basis = {
    gemeindeId: 'g-1',
    quelleSeite: 'https://www.example.ch/aktuelles',
    plattform: 'weblication' as const,
    gelesenAm: '2026-09-14T13:00:00.000Z'
  }

  it('bildet eine HTML-Mitteilung ab und nennt jede Ableitung', () => {
    const zeile = zeileAus({
      ...basis,
      eintrag: { ...eintrag('x', '2026-09-10', 'kalender'), teaser: 'Teaser' },
      detail: detail({
        datum: '2026-09-11',
        kanonisch: 'https://www.example.ch/kanonisch'
      }),
      pdf: null,
      anhaenge: []
    })
    expect(zeile).toMatchObject({
      gemeinde: 'g-1',
      url: 'https://www.example.ch/x',
      url_kanonisch: 'https://www.example.ch/kanonisch',
      titel: 'Detailtitel',
      teaser: 'Teaser',
      publiziert_am: '2026-09-11',
      inhalt_typ: 'html',
      text: 'Ein Absatz.\n\nNoch einer.',
      text_abgeschnitten: false,
      hinweise: ['Datum von der Detailseite übernommen']
    })
  })

  it('zaehlt ungelesene Anhaenge, den generischen Weg und das fehlende Datum', () => {
    const anhaenge: Anhang[] = [
      {
        bezeichnung: 'A',
        url: 'https://www.example.ch/a.pdf',
        typ: 'pdf',
        gelesen: true,
        text: 'Inhalt'
      },
      {
        bezeichnung: 'B',
        url: 'https://www.fremd.ch/b.pdf',
        typ: 'link',
        gelesen: false,
        grund: 'fremde_site'
      },
      {
        bezeichnung: 'C',
        url: 'https://www.example.ch/c.pdf',
        typ: 'link',
        gelesen: false,
        grund: 'deckel'
      }
    ]
    const zeile = zeileAus({
      ...basis,
      eintrag: eintrag('x', null),
      detail: detail({ verfahren: 'generisch' }),
      pdf: null,
      anhaenge
    })
    expect(zeile.publiziert_am).toBeNull()
    expect(zeile.hinweise).toEqual([
      'Kein Datum gefunden',
      'Inhalt generisch extrahiert – Seitenaufbau unbekannt',
      '2 Anhänge nicht gelesen'
    ])
  })

  it('ein direkt verlinktes PDF ist die Mitteilung selbst, gekappt und deklariert', () => {
    const zeile = zeileAus({
      ...basis,
      eintrag: { ...eintrag('mm.pdf', '2026-09-03'), direktPdf: true },
      detail: null,
      pdf: {
        text: `${'Absatz eins. '.repeat(1000)}\n\n${'Absatz zwei. '.repeat(1000)}`,
        seiten: 2
      },
      anhaenge: []
    })
    expect(zeile.inhalt_typ).toBe('pdf')
    expect(zeile.titel).toBe('mm.pdf')
    expect(zeile.text_abgeschnitten).toBe(true)
    expect(zeile.text?.endsWith('… [Text gekürzt]')).toBe(true)
    expect(zeile.hinweise).toEqual([
      'Text gekürzt',
      'Direkt verlinktes PDF – Text aus dem PDF'
    ])
  })

  it('ohne Text sagt die Zeile das, statt leer zu wirken', () => {
    const zeile = zeileAus({
      ...basis,
      eintrag: eintrag('x', '2026-09-10'),
      detail: detail({ text: '' }),
      pdf: null,
      anhaenge: []
    })
    expect(zeile.text).toBeNull()
    expect(zeile.hinweise).toEqual(['Kein Text gefunden'])
  })
})

describe('zeileAus: die zweite Tuer', () => {
  it('sagt auf der Zeile, wenn die Seite ueber den Crawler kam', () => {
    const zeile = zeileAus({
      eintrag: eintrag('a', '2026-09-10'),
      detail: null,
      pdf: { text: 'Text', seiten: 1 },
      anhaenge: [],
      gemeindeId: 'g',
      quelleSeite: 'https://www.example.ch/aktuelles',
      plattform: 'weblication',
      gelesenAm: '2026-09-17T11:00:00Z',
      transport: 'crawler'
    })
    expect(zeile.hinweise).toContain('Über den Crawler gelesen')
  })
})
