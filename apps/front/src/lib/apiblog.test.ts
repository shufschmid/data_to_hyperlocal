import {
  antwortText,
  artikelPfad,
  darfV1Lesen,
  freigabeText,
  gegenpruefungText,
  rubrikText,
  siegelChip,
  standText,
  terminText,
  v1Abfrage,
  verlaengere,
  type ApiArtikel,
  type ApiPruefsiegel
} from './apiblog'
import { datumText } from './amtsblatt'

const SIEGEL: ApiPruefsiegel = {
  pruefungen: { zeitbezug: [], zahlen: [], weitere: [] },
  bestanden: true,
  gegenpruefung: 'keine',
  freigabe: 'redaktion',
  freigegeben_am: null,
  publiziert_am: '2026-10-11T12:00:00.000Z',
  herkunft: { rubrik: 'presseschau', quelle_name: 'bazonline.ch', quelle_url: null }
}

function artikel(id: string): ApiArtikel {
  return {
    id,
    gemeinde: 'aesch',
    gemeinde_name: 'Aesch',
    bfs_nummer: 2761,
    rubrik: 'presseschau',
    titel: 'T',
    lead: null,
    text: null,
    publiziert_am: '2026-10-11T12:00:00.000Z',
    erscheint_am: null,
    perle: false,
    quelle_name: 'bazonline.ch',
    quelle_url: null,
    sport: null,
    termin: null,
    medium: 'bajour',
    pruefsiegel: SIEGEL
  }
}

describe('die Durchleitung — nur lesen, nur die Lesepfade, nie als Abnehmer', () => {
  it('laesst die vier Lesepfade durch und sonst nichts', () => {
    expect(darfV1Lesen('artikel')).toBe(true)
    expect(darfV1Lesen('artikel/0123abcd-4567-89ef-0123-456789abcdef')).toBe(true)
    expect(darfV1Lesen('gemeinden')).toBe(true)
    expect(darfV1Lesen('gesundheit')).toBe(true)
    expect(darfV1Lesen('korrekturen')).toBe(false)
    expect(darfV1Lesen('abnehmer/dorfkoenig')).toBe(false)
    expect(darfV1Lesen('abnehmer/dorfkoenig/abgeholt')).toBe(false)
    expect(darfV1Lesen('../items/meldungen')).toBe(false)
  })

  it('reicht nur gemeinde, grenze, versatz und seit weiter — abnehmer nie', () => {
    expect(v1Abfrage('?gemeinde=riehen&grenze=50&versatz=100&seit=2026-10-01&abnehmer=dorfkoenig&x=1')).toBe(
      '?gemeinde=riehen&grenze=50&versatz=100&seit=2026-10-01'
    )
    expect(v1Abfrage('')).toBe('')
    expect(v1Abfrage('?abnehmer=dorfkoenig')).toBe('')
  })

  it('baut die Adresse einer Seite', () => {
    expect(artikelPfad(null, 0)).toBe('/api/v1/artikel?grenze=50&versatz=0')
    expect(artikelPfad('riehen', 100, 25)).toBe('/api/v1/artikel?grenze=25&versatz=100&gemeinde=riehen')
  })
})

describe('verlaengere', () => {
  it('haengt die naechste Seite an und laesst einen doppelten Beitrag weg', () => {
    const a = artikel('a')
    const b = artikel('b')
    expect(verlaengere([a], [b, artikel('a')]).map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('antwortText', () => {
  it('sagt bei 503, dass der Dorfkoenig nichts bekommt, und nennt den Schalter', () => {
    expect(
      antwortText(503, {
        fehler: {
          code: 'schnittstelle_abgeschaltet',
          meldung: 'Die Schnittstelle ist abgeschaltet. Sie wird mit BLOG_API_OFFEN=ja eingeschaltet.'
        }
      })
    ).toBe(
      'Die Schnittstelle ist abgeschaltet — der Dorfkönig bekommt nichts. Die Schnittstelle ist abgeschaltet. Sie wird mit BLOG_API_OFFEN=ja eingeschaltet.'
    )
    expect(antwortText(503, null)).toMatch(/BLOG_API_OFFEN=ja/)
    expect(antwortText(404, { fehler: { meldung: 'Unbekannte Gemeinde «x».' } })).toBe(
      'Unbekannte Gemeinde «x».'
    )
    expect(antwortText(401, {})).toMatch(/Sitzung/)
    expect(antwortText(500, { errors: [{ message: 'kaputt' }] })).toBe('kaputt')
    expect(antwortText(502, 'nicht json')).toBe('Die Schnittstelle antwortet mit HTTP 502.')
  })
})

describe('die Etiketten', () => {
  it('Rubrik, Gegenpruefung, Freigabe', () => {
    expect(rubrikText('presseschau')).toBe('Presseschau')
    expect(rubrikText(null)).toBe('ohne Rubrik')
    expect(gegenpruefungText({ gegenpruefung: 'keine' })).toBeNull()
    expect(gegenpruefungText({ gegenpruefung: 'ja' })).toBe('gegengelesen: ja')
    expect(freigabeText({ freigabe: 'freigegeben_dann_zeitlauf' })).toBe(
      'freigegeben, vom Zeitlauf publiziert'
    )
  })

  it('das Siegel: bestanden, oder die Hinweise gezaehlt und aufgefuehrt', () => {
    expect(siegelChip(SIEGEL)).toEqual({ text: 'Prüfsiegel bestanden', farbe: 'success', hinweise: [] })
    const offen = siegelChip({
      ...SIEGEL,
      bestanden: false,
      pruefungen: {
        zeitbezug: ['Relativer Zeitbezug: "gestern"'],
        zahlen: [],
        weitere: ['Wörtliche Übernahme …']
      }
    })
    expect(offen.text).toBe('2 Hinweise im Prüfsiegel')
    expect(offen.farbe).toBe('warning')
    expect(offen.hinweise).toHaveLength(2)
  })

  it('der Termin, wie der Dorfkoenig ihn liest', () => {
    expect(terminText(null, datumText)).toBeNull()
    expect(
      terminText(
        { ideal: '2026-10-18', ende: '2026-10-18', auftritte: ['2026-10-16', '2026-10-18'] },
        datumText
      )
    ).toBe('zählt am 18. Oktober 2026 · Auftritte: 16. Oktober 2026, 18. Oktober 2026')
    expect(terminText({ ideal: '2026-10-01', ende: '2026-10-31' }, datumText)).toBe(
      'zählt am 1. Oktober 2026 bis 31. Oktober 2026'
    )
  })

  it('der Stand der Liste', () => {
    expect(standText(0, 0)).toBe('Keine Beiträge auf der Schnittstelle.')
    expect(standText(1, 1)).toBe('1 Beitrag auf der Schnittstelle.')
    expect(standText(50, 128)).toBe('50 von 128 Beiträgen.')
    expect(standText(128, 128)).toBe('Alle 128 Beiträge.')
  })
})
