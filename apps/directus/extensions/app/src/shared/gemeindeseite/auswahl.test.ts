import { describe, expect, it } from 'vitest'
import {
  bestimmeDatum,
  fensterSeit,
  kandidaten,
  ohneDatumHinweis,
  terminKandidaten,
  VERANSTALTUNGS_FENSTER_TAGE,
  verteileDetailbudget,
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

const termin = (
  url: string,
  veranstaltungAm: string | null
): ListenEintrag => ({
  ...eintrag(url, null),
  veranstaltungAm
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

describe('verteileDetailbudget', () => {
  const HEUTE = '2026-09-18'

  it('neueste zuerst, Undatierte zuletzt, der Rest wird gezaehlt', () => {
    const liste = [
      eintrag('ohne', null),
      eintrag('a', '2026-09-10'),
      eintrag('b', '2026-09-13'),
      eintrag('c', '2026-09-12')
    ]
    const [nachrichten] = verteileDetailbudget(
      [{ art: 'nachricht', neue: liste }],
      HEUTE,
      3
    )
    expect(nachrichten?.zuLesen.map((e) => e.titel)).toEqual(['b', 'c', 'a'])
    expect(nachrichten?.nichtGelesen).toBe(1)
  })

  it('teilt EIN Budget ueber beide Seiten desselben Hosts', () => {
    const [nachrichten, termine] = verteileDetailbudget(
      [
        {
          art: 'nachricht',
          neue: [
            eintrag('heute', '2026-09-18'),
            eintrag('gestern', '2026-09-17'),
            eintrag('vorgestern', '2026-09-16')
          ]
        },
        {
          art: 'termin',
          neue: [
            termin('morgen', '2026-09-19'),
            termin('uebermorgen', '2026-09-20'),
            termin('spaeter', '2026-09-21')
          ]
        }
      ],
      HEUTE,
      4
    )
    const gelesen =
      (nachrichten?.zuLesen.length ?? 0) + (termine?.zuLesen.length ?? 0)
    expect(gelesen).toBe(4)
    expect(nachrichten?.zuLesen.map((e) => e.titel)).toEqual([
      'heute',
      'gestern'
    ])
    expect(termine?.zuLesen.map((e) => e.titel)).toEqual([
      'morgen',
      'uebermorgen'
    ])
    expect(nachrichten?.nichtGelesen).toBe(1)
    expect(termine?.nichtGelesen).toBe(1)
  })

  it('nimmt den Anlass von morgen vor die Nachricht von vorgestern', () => {
    const [nachrichten, termine] = verteileDetailbudget(
      [
        { art: 'nachricht', neue: [eintrag('vorgestern', '2026-09-16')] },
        { art: 'termin', neue: [termin('morgen', '2026-09-19')] }
      ],
      HEUTE,
      1
    )
    expect(termine?.zuLesen.map((e) => e.titel)).toEqual(['morgen'])
    expect(nachrichten?.zuLesen).toEqual([])
    expect(nachrichten?.nichtGelesen).toBe(1)
  })

  it('nimmt die Nachricht von heute vor den Anlass in zwei Monaten', () => {
    const [nachrichten, termine] = verteileDetailbudget(
      [
        { art: 'nachricht', neue: [eintrag('heute', '2026-09-18')] },
        { art: 'termin', neue: [termin('weihnachtsmarkt', '2026-11-17')] }
      ],
      HEUTE,
      1
    )
    expect(nachrichten?.zuLesen.map((e) => e.titel)).toEqual(['heute'])
    expect(termine?.zuLesen).toEqual([])
    expect(termine?.nichtGelesen).toBe(1)
  })

  it('laesst bei gleichem Abstand den Termin vorgehen', () => {
    const [nachrichten, termine] = verteileDetailbudget(
      [
        { art: 'nachricht', neue: [eintrag('gestern', '2026-09-17')] },
        { art: 'termin', neue: [termin('morgen', '2026-09-19')] }
      ],
      HEUTE,
      1
    )
    expect(termine?.zuLesen.map((e) => e.titel)).toEqual(['morgen'])
    expect(nachrichten?.zuLesen).toEqual([])
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

describe('terminKandidaten', () => {
  // The one place the events page really thinks differently: a news item is
  // past, an event lies ahead, so the window runs forward instead of back.
  it('nimmt, was zwischen heute und der Obergrenze stattfindet', () => {
    const { drin } = terminKandidaten(
      [
        termin('gestern', '2026-09-17'),
        termin('heute', '2026-09-18'),
        termin('bald', '2026-10-20'),
        termin('grenze', '2026-11-17'),
        termin('danach', '2026-11-18')
      ],
      '2026-09-18',
      60
    )
    expect(drin.map((e) => e.titel)).toEqual(['heute', 'bald', 'grenze'])
  })

  it('eine laufende Spanne bleibt drin, bis ihr letzter Tag vorbei ist', () => {
    const laufend = {
      ...termin('ausstellung', '2026-05-09'),
      veranstaltungBis: '2026-11-30'
    }
    const vorbei = {
      ...termin('vorbei', '2026-05-09'),
      veranstaltungBis: '2026-09-17'
    }
    const { drin } = terminKandidaten([laufend, vorbei], '2026-09-18', 60)
    expect(drin.map((e) => e.titel)).toEqual(['ausstellung'])
  })

  it('zaehlt Termine ohne Datum, statt sie zu oeffnen', () => {
    const { drin, undatiert } = terminKandidaten(
      [termin('ohne', null), termin('mit', '2026-10-01')],
      '2026-09-18',
      60
    )
    expect(drin).toHaveLength(1)
    expect(undatiert.map((e) => e.titel)).toEqual(['ohne'])
  })

  it('haelt die Obergrenze als benannte Konstante', () => {
    expect(VERANSTALTUNGS_FENSTER_TAGE).toBe(60)
  })
})

describe('verteileDetailbudget: Termine', () => {
  it('sortiert Termine nach dem, was als Naechstes dran ist', () => {
    const [termine] = verteileDetailbudget(
      [
        {
          art: 'termin',
          neue: [termin('spaet', '2026-11-01'), termin('frueh', '2026-09-20')]
        }
      ],
      '2026-09-18',
      10
    )
    expect(termine?.zuLesen.map((e) => e.titel)).toEqual(['frueh', 'spaet'])
  })
})

describe('zeileAus: ein Termin', () => {
  it('traegt das Veranstaltungsdatum und KEIN Publikationsdatum', () => {
    const zeile = zeileAus({
      eintrag: termin('anlass', '2026-10-13'),
      // Measured on all six events pages: none of them prints when the entry
      // was published, and the detail page prints the event's own day. Reading
      // that as a publication date would fuse the two dates the desk has to
      // keep apart.
      detail: detail({ datum: '2026-10-13' }),
      pdf: null,
      anhaenge: [],
      gemeindeId: 'g1',
      quelleSeite: 'https://www.example.ch/de/veranstaltungen/',
      plattform: 'weblication_termine',
      gelesenAm: '2026-09-18T13:00:00.000Z'
    })
    expect(zeile.veranstaltung_am).toBe('2026-10-13')
    expect(zeile.publiziert_am).toBeNull()
    expect(zeile.hinweise).toContain(
      'Veranstaltung — die Seite nennt kein Publikationsdatum'
    )
  })
})
