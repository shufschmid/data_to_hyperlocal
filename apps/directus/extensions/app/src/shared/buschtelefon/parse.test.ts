import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AntwortFormatFehler,
  hoechsteFolge,
  istTag,
  istZeitpunkt,
  liesFreigabe,
  liesFund,
  liesFundeAntwort,
  liesQuellenAntwort,
  tagInZuerich,
  veroeffentlichtTag
} from './parse'
import { FORMAT, GRENZEN, istEntfernt, type Fund } from './typen'

// Invented data throughout: no real group, no real post, no real person.

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))
}

function rohFund(nr: number): Record<string, unknown> {
  const funde = fixture('funde.json')['funde'] as Record<string, unknown>[]
  return structuredClone(funde[nr]!)
}

/** The text post with comments, with fields overridden. */
function fundMit(ueber: Record<string, unknown>): Record<string, unknown> {
  return { ...rohFund(1), ...ueber }
}

function gelesen(roh: unknown): Fund {
  const ergebnis = liesFund(roh)
  if (!ergebnis.ok) throw new Error(`ungültig: ${ergebnis.ungueltig.grund}`)
  if (istEntfernt(ergebnis.fund)) throw new Error('entfernt')
  return ergebnis.fund
}

function grund(roh: unknown): string {
  const ergebnis = liesFund(roh)
  if (ergebnis.ok) throw new Error('unerwartet gültig')
  return ergebnis.ungueltig.grund
}

describe('tagInZuerich', () => {
  it('liest den Tag in Zürich, nicht in UTC – der Fehler «einen Tag zu früh»', () => {
    // 00:30 on 8 November in Zurich is 23:30 on the 7th in UTC.
    expect(tagInZuerich('2026-11-08T00:30:00+01:00')).toBe('2026-11-08')
    expect(tagInZuerich('2026-11-08T00:00:00+01:00')).toBe('2026-11-08')
    expect(
      new Date('2026-11-08T00:30:00+01:00').toISOString().slice(0, 10)
    ).toBe('2026-11-07')
  })

  it('zählt einen UTC-Abend zum nächsten Zürcher Tag', () => {
    expect(tagInZuerich('2026-11-08T23:30:00Z')).toBe('2026-11-09')
    expect(tagInZuerich('2026-11-08T22:59:00Z')).toBe('2026-11-08')
  })

  it('kennt die Sommerzeit', () => {
    expect(tagInZuerich('2026-07-01T22:30:00Z')).toBe('2026-07-02')
    expect(tagInZuerich('2026-07-01T21:59:00Z')).toBe('2026-07-01')
  })

  it('nimmt ein Date und gibt für Unlesbares null', () => {
    expect(tagInZuerich(new Date('2026-11-11T11:00:00Z'))).toBe('2026-11-11')
    expect(tagInZuerich(null)).toBeNull()
    expect(tagInZuerich(undefined)).toBeNull()
    expect(tagInZuerich('gestern')).toBeNull()
    expect(tagInZuerich(new Date(Number.NaN))).toBeNull()
  })
})

describe('veroeffentlichtTag', () => {
  const basis = {
    veroeffentlicht_fruehestens: null,
    veroeffentlicht_spaetestens: null
  }

  it('druckt den Tag einer genauen Angabe', () => {
    expect(
      veroeffentlichtTag({
        ...basis,
        veroeffentlicht_am: '2026-11-08T19:42:00+01:00',
        datum_genauigkeit: 'minute'
      })
    ).toBe('2026-11-08')
  })

  it('druckt bei «ungefaehr» nur, wenn beide Grenzen auf denselben Tag fallen', () => {
    const ungefaehr = {
      veroeffentlicht_am: '2026-11-04T12:00:00+01:00',
      datum_genauigkeit: 'ungefaehr' as const
    }
    expect(
      veroeffentlichtTag({
        ...ungefaehr,
        veroeffentlicht_fruehestens: '2026-11-01T00:00:00+01:00',
        veroeffentlicht_spaetestens: '2026-11-07T23:59:00+01:00'
      })
    ).toBeNull()
    expect(
      veroeffentlichtTag({
        ...ungefaehr,
        veroeffentlicht_fruehestens: '2026-11-04T06:00:00+01:00',
        veroeffentlicht_spaetestens: '2026-11-04T18:00:00+01:00'
      })
    ).toBe('2026-11-04')
    expect(veroeffentlichtTag({ ...ungefaehr, ...basis })).toBeNull()
  })

  it('druckt bei «unbekannt» nichts', () => {
    expect(
      veroeffentlichtTag({
        ...basis,
        veroeffentlicht_am: '2026-11-08T19:42:00+01:00',
        datum_genauigkeit: 'unbekannt'
      })
    ).toBeNull()
  })
})

describe('istZeitpunkt / istTag', () => {
  it('verlangt einen Zeitzonenversatz', () => {
    expect(istZeitpunkt('2026-11-08T19:42:00+01:00')).toBe(true)
    expect(istZeitpunkt('2026-11-08T19:42:00Z')).toBe(true)
    expect(istZeitpunkt('2026-11-08T19:42:00.123+01:00')).toBe(true)
    expect(istZeitpunkt('2026-11-08T19:42:00')).toBe(false)
    expect(istZeitpunkt('2026-11-08')).toBe(false)
    expect(istZeitpunkt('2026-13-40T19:42:00+01:00')).toBe(false)
    expect(istZeitpunkt(1_700_000_000)).toBe(false)
  })

  it('kennt nur echte Kalendertage', () => {
    expect(istTag('2026-11-22')).toBe(true)
    expect(istTag('2026-02-30')).toBe(false)
    expect(istTag('22.11.2026')).toBe(false)
    expect(istTag(null)).toBe(false)
  })
})

describe('liesFundeAntwort – die Fixture', () => {
  const antwort = liesFundeAntwort(fixture('funde.json'))

  it('liest die Freigabe', () => {
    expect(antwort.freigabe).toEqual({
      tag: '2026-11-11',
      folge: 18422,
      freigegeben_am: '2026-11-11T11:52:10+01:00',
      sammellauf_begonnen_am: '2026-11-11T11:00:02+01:00',
      sammellauf_beendet_am: '2026-11-11T11:51:40+01:00',
      quellen_offen: [{ quelle: 'fb-gruppe:99', grund: 'fehler' }]
    })
    expect(antwort.weiter).toBeNull()
  })

  it('liefert fünf Funde aufsteigend nach folge und nennt den ungültigen', () => {
    expect(antwort.funde.map((f) => f.folge)).toEqual([
      17601, 17650, 17655, 17660, 17670
    ])
    expect(antwort.ungueltig).toEqual([
      { kennung: 'fb:1000000001_2000000006', folge: 17680, grund: 'link fehlt' }
    ])
  })

  it('liest den Flyer-Beitrag: leerer Text, Bildtext wörtlich, fehlende Bilder sichtbar', () => {
    const flyer = antwort.funde[0] as Fund
    expect(flyer.text).toBe('')
    expect(flyer.bilder).toHaveLength(2)
    expect(flyer.bilder[0]).toEqual({
      nr: 1,
      art: 'flyer',
      text_status: 'gelesen',
      text: 'Räbeliechtli-Umzug\nFreitag, 13. November 2026, 18 Uhr\nBesammlung Schulhaus Neumatt',
      text_abgeschnitten: false,
      beschreibung: 'Flyer mit Laternen-Zeichnung'
    })
    expect(flyer.bilder[1]).toMatchObject({
      text_status: 'kein_text',
      text: null,
      beschreibung: null
    })
    expect(flyer.n_bilder).toBe(5)
    expect(flyer.autor_vorname).toBe('Petra')
    expect(flyer.kuerzungen).toEqual([])
    expect(veroeffentlichtTag(flyer)).toBe('2026-11-09')
  })

  it('liest den Textbeitrag mit Kommentaren samt Antwort und entferntem Kommentar', () => {
    const beitrag = antwort.funde[1] as Fund
    expect(beitrag.aenderung).toEqual(['kommentare'])
    expect(beitrag.verlinkt).toEqual([
      {
        url: 'https://www.musterdorf.example/baustellen/hauptstrasse',
        kurzlink: false,
        titel: 'Baustelleninfo Hauptstrasse',
        text_status: 'nicht_versucht',
        text: null,
        text_abgeschnitten: false
      }
    ])
    expect(
      beitrag.kommentare.map((k) => [
        k.kennung,
        k.antwort_auf,
        k.autor_ref,
        k.autor_vorname
      ])
    ).toEqual([
      ['k:9f3a01', null, 'B', 'Marc'],
      ['k:9f3a02', 'k:9f3a01', 'A', 'Sandra'],
      ['k:9f3a03', null, 'C', null]
    ])
    expect(beitrag.kommentare[2]).toMatchObject({
      stand: 'entfernt',
      text: null,
      n_reaktionen: null
    })
    expect(beitrag.kommentare_stand).toBe('vollstaendig')
    expect(beitrag.kuerzungen).toEqual([])
  })

  it('hält den geteilten Polizeibeitrag getrennt vom Text des Teilenden', () => {
    const geteilt = antwort.funde[2] as Fund
    expect(geteilt.text).toBe('Achtung!')
    expect(geteilt.autor_rolle).toBeNull()
    expect(geteilt.geteilt).toMatchObject({
      link: 'https://www.facebook.com/musterpolizei/posts/3000000001',
      quelle_name: 'Musterpolizei',
      autor_rolle: 'behoerde',
      autor_name: 'Musterpolizei'
    })
    expect(geteilt.geteilt?.text).toContain('Zeugenaufruf')
  })

  it('liest den Beitrag aus der geschlossenen Gruppe mit mehreren Gemeinden', () => {
    const geschlossen = antwort.funde[3] as Fund
    expect(geschlossen.quelle_sichtbarkeit).toBe('geschlossen')
    expect(geschlossen.gemeinden_bfs).toEqual([2761, 2763])
    expect(geschlossen.autor_art).toBe('anonym')
    expect(geschlossen.bilder[0]).toMatchObject({
      art: 'privatchat',
      text_status: 'zurueckgehalten',
      text: null
    })
    expect(geschlossen.kommentare_stand).toBe('gedeckelt')
    expect(geschlossen.kommentare_fehlend).toBe(20)
    expect(geschlossen.n_kommentare).toBeNull()
    expect(veroeffentlichtTag(geschlossen)).toBeNull()
  })

  it('liest den Grabstein mit genau seinen Feldern', () => {
    expect(antwort.funde[4]).toEqual({
      kennung: 'fb:1000000001_2000000005',
      folge: 17670,
      status: 'entfernt',
      entfernt_grund: 'an_der_quelle_geloescht',
      aenderung: ['status'],
      erstmals_freigegeben_am: '2026-11-05T11:50:00+01:00',
      geaendert_am: '2026-11-11T11:52:10+01:00',
      kanal: 'facebook',
      quelle: 'fb-gruppe:1000000001',
      gemeinden_bfs: [2761]
    })
  })

  it('liest den ausgelassenen Eintrag', () => {
    expect(antwort.ausgelassen).toEqual([
      {
        kennung: 'fb:1000000001_2000000007',
        folge: 17690,
        grund: 'kein_link',
        quelle: 'fb-gruppe:1000000001',
        kanal: 'facebook',
        gemeinden_bfs: [2761],
        veroeffentlicht_am: '2026-11-10T09:00:00+01:00'
      }
    ])
  })

  it('zählt für das Lesezeichen Funde, Ausgelassene und Ungültige', () => {
    expect(hoechsteFolge(antwort)).toBe(17690)
    expect(
      hoechsteFolge({ funde: [], ausgelassen: [], ungueltig: [], weiter: null })
    ).toBeNull()
    expect(
      hoechsteFolge({
        funde: [],
        ausgelassen: [],
        ungueltig: [{ kennung: null, folge: 12, grund: 'x' }],
        weiter: null
      })
    ).toBe(12)
  })
})

describe('liesFundeAntwort – der Umschlag', () => {
  const gueltig = () => fixture('funde.json')

  it('verweigert jede andere Format-Kennung', () => {
    expect(() =>
      liesFundeAntwort({ ...gueltig(), format: 'buschtelefon-redaktion/1' })
    ).toThrow(AntwortFormatFehler)
    expect(() => liesFundeAntwort({ ...gueltig(), format: undefined })).toThrow(
      /ohne Angabe/
    )
    expect(() => liesFundeAntwort([])).toThrow(AntwortFormatFehler)
    expect(() => liesFundeAntwort(null)).toThrow(AntwortFormatFehler)
  })

  it('verweigert eine Antwort ohne Freigabe, ohne Fundliste oder mit unlesbarem «weiter»', () => {
    expect(() => liesFundeAntwort({ ...gueltig(), freigabe: null })).toThrow(
      /freigabe/
    )
    expect(() => liesFundeAntwort({ ...gueltig(), funde: {} })).toThrow(/funde/)
    expect(() => liesFundeAntwort({ ...gueltig(), weiter: '17650' })).toThrow(
      /weiter/
    )
    expect(() => liesFundeAntwort({ ...gueltig(), weiter: 0 })).toThrow(
      /weiter/
    )
  })

  it('nimmt eine fehlende Liste «ausgelassen» als leer und liest «weiter»', () => {
    const { ausgelassen: _weg, ...ohne } = gueltig()
    const antwort = liesFundeAntwort({ ...ohne, weiter: 17690 })
    expect(antwort.ausgelassen).toEqual([])
    expect(antwort.weiter).toBe(17690)
  })

  it('sortiert nach folge, was die Tür unsortiert schickt', () => {
    const roh = gueltig()
    const antwort = liesFundeAntwort({
      ...roh,
      funde: [...(roh['funde'] as unknown[])].reverse()
    })
    expect(antwort.funde.map((f) => f.folge)).toEqual([
      17601, 17650, 17655, 17660, 17670
    ])
  })

  it('nennt einen unlesbaren ausgelassenen Eintrag mit seiner folge', () => {
    const antwort = liesFundeAntwort({
      ...gueltig(),
      ausgelassen: [
        { kennung: 'fb:1_2', folge: 17700, grund: 'zu_lang' },
        'kaputt'
      ]
    })
    expect(antwort.ausgelassen).toEqual([])
    expect(antwort.ungueltig.slice(1)).toEqual([
      {
        kennung: 'fb:1_2',
        folge: 17700,
        grund: 'ausgelassen: grund: unbekannter Wert «zu_lang»'
      },
      { kennung: null, folge: null, grund: 'ausgelassen: kein Objekt' }
    ])
  })

  it('liest eine Freigabe mit unbekanntem Grund, ohne ihn zu erraten', () => {
    expect(
      liesFreigabe({
        tag: '2026-11-11',
        folge: 0,
        freigegeben_am: '2026-11-11T11:52:10+01:00',
        quellen_offen: [
          { quelle: 'fb-gruppe:1', grund: 'ferien' },
          { grund: 'fehler' }
        ]
      })
    ).toEqual({
      tag: '2026-11-11',
      folge: 0,
      freigegeben_am: '2026-11-11T11:52:10+01:00',
      sammellauf_begonnen_am: null,
      sammellauf_beendet_am: null,
      quellen_offen: [{ quelle: 'fb-gruppe:1', grund: null }]
    })
    expect(() =>
      liesFreigabe({ tag: '11.11.2026', folge: 1, freigegeben_am: 'x' })
    ).toThrow(/tag/)
    expect(() =>
      liesFreigabe({
        tag: '2026-11-11',
        folge: 1,
        freigegeben_am: '2026-11-11T11:52:10'
      })
    ).toThrow(/freigegeben_am/)
  })
})

describe('liesFund – nie ein Wurf, immer ein Grund', () => {
  it('wirft bei keiner Eingabe', () => {
    for (const roh of [
      null,
      undefined,
      7,
      'text',
      [],
      {},
      { kennung: 5 },
      { kennung: 'a', folge: 1 }
    ])
      expect(() => liesFund(roh)).not.toThrow()
    expect(liesFund(null)).toEqual({
      ok: false,
      ungueltig: { kennung: null, folge: null, grund: 'kein Objekt' }
    })
  })

  it('nennt kennung und folge des ungültigen Fundes, damit das Lesezeichen vorbeikommt', () => {
    expect(liesFund(fundMit({ kanal: 'fax' }))).toEqual({
      ok: false,
      ungueltig: {
        kennung: 'fb:1000000001_2000000002',
        folge: 17650,
        grund: 'kanal: unbekannter Wert «fax»'
      }
    })
    expect(liesFund(fundMit({ folge: '17650' }))).toMatchObject({
      ok: false,
      ungueltig: { kennung: 'fb:1000000001_2000000002', folge: null }
    })
  })

  it('hält unbekannte Enum-Werte draussen, statt sie zu erraten', () => {
    expect(grund(fundMit({ status: 'archiviert' }))).toBe(
      'status: unbekannter Wert «archiviert»'
    )
    expect(grund(fundMit({ quelle_sichtbarkeit: 'privat' }))).toMatch(
      /quelle_sichtbarkeit/
    )
    expect(grund(fundMit({ quelle_art: 'profil' }))).toMatch(/quelle_art/)
    expect(grund(fundMit({ datum_genauigkeit: 'sekunde' }))).toMatch(
      /datum_genauigkeit/
    )
    expect(grund(fundMit({ autor_art: 'bot' }))).toMatch(/autor_art/)
    expect(grund(fundMit({ autor_rolle: 'partei' }))).toMatch(/autor_rolle/)
    expect(grund(fundMit({ kommentare_stand: 'halb' }))).toMatch(
      /kommentare_stand/
    )
  })

  it('ignoriert ein unbekanntes Zusatzfeld', () => {
    const fund = gelesen(fundMit({ stimmung: 'gereizt', zusammenfassung: 'x' }))
    expect(fund).not.toHaveProperty('stimmung')
    expect(fund).not.toHaveProperty('zusammenfassung')
    expect(fund.kuerzungen).toEqual([])
  })

  it('verlangt Zeitpunkte mit Versatz', () => {
    expect(grund(fundMit({ veroeffentlicht_am: '2026-11-08T19:42:00' }))).toBe(
      'veroeffentlicht_am ist kein Zeitpunkt mit Zeitzonenversatz'
    )
    expect(grund(fundMit({ erstmals_freigegeben_am: null }))).toBe(
      'erstmals_freigegeben_am fehlt'
    )
    expect(grund(fundMit({ beobachtet_bis: '22.11.2026' }))).toMatch(
      /beobachtet_bis/
    )
  })

  it('kürzt nie eine Kennung oder eine Adresse – der Fund ist dann ungültig', () => {
    expect(grund(fundMit({ kennung: `fb:${'9'.repeat(70)}` }))).toMatch(
      /kennung ist länger als 64/
    )
    expect(
      grund(fundMit({ link: `https://www.facebook.com/${'a'.repeat(2000)}` }))
    ).toMatch(/link ist länger als 2000/)
    expect(
      grund(fundMit({ link: 'http://www.facebook.com/groups/1/posts/2' }))
    ).toBe('link ist keine https-Adresse')
    expect(grund(fundMit({ quelle: 'q'.repeat(101) }))).toMatch(
      /quelle ist länger als 100/
    )
  })

  it('verlangt die Listen und die BFS-Nummern', () => {
    expect(grund(fundMit({ kommentare: null }))).toBe(
      'kommentare fehlt oder ist keine Liste'
    )
    expect(grund(fundMit({ bilder: undefined }))).toBe(
      'bilder fehlt oder ist keine Liste'
    )
    expect(grund(fundMit({ gemeinden_bfs: ['aesch'] }))).toMatch(/BFS-Nummern/)
    expect(gelesen(fundMit({ gemeinden_bfs: [] })).gemeinden_bfs).toEqual([])
    expect(
      gelesen(fundMit({ gemeinden_bfs: [2761, 2761] })).gemeinden_bfs
    ).toEqual([2761])
  })

  it('nimmt fehlende Zähler als unbekannt und verweigert unsinnige', () => {
    const {
      n_reaktionen: _a,
      n_geteilt: _b,
      kommentare_fehlend: _c,
      ...ohne
    } = fundMit({})
    expect(gelesen(ohne)).toMatchObject({
      n_reaktionen: null,
      n_geteilt: null,
      kommentare_fehlend: null
    })
    expect(grund(fundMit({ n_kommentare: -1 }))).toBe(
      'n_kommentare ist keine ganze Zahl ab 0'
    )
    expect(grund(fundMit({ n_kommentare: '1,2 Tsd.' }))).toMatch(/n_kommentare/)
  })

  it('setzt veroeffentlicht_am bei «unbekannt» auf null', () => {
    expect(
      gelesen(
        fundMit({
          datum_genauigkeit: 'unbekannt',
          veroeffentlicht_am: '2026-11-08T19:42:00+01:00'
        })
      ).veroeffentlicht_am
    ).toBeNull()
  })

  it('zeigt nicht auf sich selbst als Doublette', () => {
    expect(
      gelesen(fundMit({ doublette_von: 'fb:1000000001_2000000002' }))
        .doublette_von
    ).toBeNull()
    expect(
      gelesen(fundMit({ doublette_von: 'fb:1000000001_1' })).doublette_von
    ).toBe('fb:1000000001_1')
  })

  it('liest nicht_erreichbar vollständig', () => {
    expect(gelesen(fundMit({ status: 'nicht_erreichbar' }))).toMatchObject({
      status: 'nicht_erreichbar',
      text: expect.stringContaining('Hauptstrasse')
    })
  })
})

describe('liesFund – zu lang wird gekürzt und deklariert', () => {
  it('kürzt den Text des Beitrags und setzt das Kürzungszeichen', () => {
    const fund = gelesen(fundMit({ text: 'a'.repeat(GRENZEN.text + 5) }))
    expect(fund.text).toHaveLength(GRENZEN.text)
    expect(fund.text_abgeschnitten).toBe(true)
    expect(fund.kuerzungen).toEqual([
      'Text des Beitrags gekürzt: 20005 Zeichen, Grenze 20000'
    ])
  })

  it('schneidet nie durch ein Ersatzzeichenpaar', () => {
    const fund = gelesen(
      fundMit({ text: `${'a'.repeat(GRENZEN.text - 1)}😀b` })
    )
    expect(fund.text).toBe('a'.repeat(GRENZEN.text - 1))
  })

  it('kürzt Bildtext, Beschreibung, Linktitel, Kommentartext und Quellenname', () => {
    const roh = fundMit({ quelle_name: 'n'.repeat(300) })
    roh['bilder'] = [
      {
        nr: 1,
        art: 'screenshot',
        text_status: 'gelesen',
        text: 'b'.repeat(GRENZEN.bild_text + 1),
        text_abgeschnitten: false,
        beschreibung: 'c'.repeat(301)
      }
    ]
    ;(roh['verlinkt'] as Record<string, unknown>[])[0]!['titel'] = 't'.repeat(
      501
    )
    ;(roh['kommentare'] as Record<string, unknown>[])[0]!['text'] = 'k'.repeat(
      GRENZEN.kommentar_text + 1
    )
    const fund = gelesen(roh)
    expect(fund.quelle_name).toHaveLength(255)
    expect(fund.bilder[0]).toMatchObject({ text_abgeschnitten: true })
    expect(fund.bilder[0]!.text).toHaveLength(GRENZEN.bild_text)
    expect(fund.bilder[0]!.beschreibung).toHaveLength(300)
    expect(fund.verlinkt[0]!.titel).toHaveLength(500)
    expect(fund.kommentare[0]!.text).toHaveLength(GRENZEN.kommentar_text)
    expect(fund.kommentare[0]!.text_abgeschnitten).toBe(true)
    expect(fund.kuerzungen).toEqual([
      'quelle_name gekürzt: 300 Zeichen, Grenze 255',
      'Bild 1: Bildtext gekürzt: 10001 Zeichen, Grenze 10000',
      'Bild 1: Beschreibung gekürzt: 301 Zeichen, Grenze 300',
      'Link 1: Titel gekürzt: 501 Zeichen, Grenze 500',
      'Kommentar 1: Text gekürzt: 5001 Zeichen, Grenze 5000'
    ])
  })

  it('kürzt den Text einer gelesenen Zielseite', () => {
    const roh = fundMit({})
    Object.assign((roh['verlinkt'] as Record<string, unknown>[])[0]!, {
      text_status: 'gelesen',
      text: 'z'.repeat(GRENZEN.verlinkt_text + 1)
    })
    const fund = gelesen(roh)
    expect(fund.verlinkt[0]).toMatchObject({
      text_status: 'gelesen',
      text_abgeschnitten: true
    })
    expect(fund.verlinkt[0]!.text).toHaveLength(GRENZEN.verlinkt_text)
  })
})

describe('liesFund – ein unlesbarer Teil kostet sich selbst, nie den Fund', () => {
  it('lässt ein Bild mit unbekanntem Status aus und sagt es', () => {
    const fund = gelesen(
      fundMit({
        bilder: [
          {
            nr: 1,
            art: 'foto',
            text_status: 'vielleicht',
            text: null,
            text_abgeschnitten: false
          },
          {
            nr: 2,
            art: 'foto',
            text_status: 'kein_text',
            text: null,
            text_abgeschnitten: false
          },
          'kaputt'
        ]
      })
    )
    expect(fund.bilder.map((b) => b.nr)).toEqual([2])
    expect(fund.kuerzungen).toEqual([
      'Bild 1 ausgelassen: text_status: unbekannter Wert «vielleicht»',
      'Bild 3 ausgelassen: kein Objekt'
    ])
  })

  it('lässt einen Kommentar ohne Kennung, mit doppelter Kennung oder unbekanntem Stand aus', () => {
    const roh = fundMit({})
    const kommentare = roh['kommentare'] as Record<string, unknown>[]
    kommentare.push({ ...kommentare[0], kennung: undefined })
    kommentare.push({ ...kommentare[0] })
    kommentare.push({ ...kommentare[0], kennung: 'k:neu', stand: 'versteckt' })
    const fund = gelesen(roh)
    expect(fund.kommentare).toHaveLength(3)
    expect(fund.kuerzungen).toEqual([
      'Kommentar 4 ausgelassen: kennung fehlt',
      'Kommentar 6 ausgelassen: stand: unbekannter Wert «versteckt»',
      'Kommentar 5 ausgelassen: kennung kommt im Fund zweimal vor'
    ])
  })

  it('lässt einen Link ohne Webadresse aus', () => {
    const roh = fundMit({})
    ;(roh['verlinkt'] as Record<string, unknown>[])[0]!['url'] =
      'javascript:alert(1)'
    const fund = gelesen(roh)
    expect(fund.verlinkt).toEqual([])
    expect(fund.kuerzungen).toEqual([
      'Link 1 ausgelassen: url ist keine Webadresse'
    ])
  })

  it('lässt einen unlesbaren geteilten Beitrag aus, statt ihn als «teilt nichts» auszugeben, ohne es zu sagen', () => {
    const fund = gelesen({ ...rohFund(2), geteilt: { text: 'ohne alles' } })
    expect(fund.geteilt).toBeNull()
    expect(fund.kuerzungen).toEqual([
      'Geteilter Beitrag ausgelassen: autor_art fehlt'
    ])
  })

  it('meldet unbekannte Angaben in «aenderung», ohne den Fund zu verlieren', () => {
    const fund = gelesen(fundMit({ aenderung: ['kommentare', 'laune'] }))
    expect(fund.aenderung).toEqual(['kommentare'])
    expect(fund.kuerzungen).toEqual([
      'aenderung: 1 unbekannte Angabe(n) – nicht übernommen'
    ])
  })
})

describe('liesFund – die Personenregeln der Tür, hier ein zweites Mal gehalten', () => {
  it('übernimmt keinen autor_name ohne autor_rolle – und nennt ihn nicht im Hinweis', () => {
    const fund = gelesen(fundMit({ autor_name: 'Sandra Beispielmann' }))
    expect(fund.autor_name).toBeNull()
    expect(fund.kuerzungen).toEqual([
      'Beitrag: autor_name ohne autor_rolle – nicht übernommen'
    ])
    expect(JSON.stringify(fund.kuerzungen)).not.toContain('Beispielmann')
  })

  it('übernimmt den Namen einer Organisation aus der Liste der Tür', () => {
    const fund = gelesen(
      fundMit({
        autor_art: 'seite',
        autor_rolle: 'behoerde',
        autor_name: 'Gemeinde Musterdorf',
        autor_vorname: null
      })
    )
    expect(fund).toMatchObject({
      autor_rolle: 'behoerde',
      autor_name: 'Gemeinde Musterdorf',
      autor_vorname: null
    })
  })

  it('übernimmt einen Vornamen nur als ein einzelnes Wort eines Profils', () => {
    const ganz = gelesen(fundMit({ autor_vorname: 'Sandra Beispielmann' }))
    expect(ganz.autor_vorname).toBeNull()
    expect(ganz.kuerzungen).toEqual([
      'Beitrag: autor_vorname ist nicht ein einzelnes Wort – nicht übernommen'
    ])
    expect(JSON.stringify(ganz.kuerzungen)).not.toContain('Beispielmann')

    expect(gelesen(fundMit({ autor_vorname: ' Sandra ' })).autor_vorname).toBe(
      'Sandra'
    )
    expect(
      gelesen(fundMit({ autor_vorname: 'x'.repeat(61) })).autor_vorname
    ).toBeNull()
    expect(
      gelesen(fundMit({ autor_art: 'seite', autor_vorname: 'Sandra' }))
        .autor_vorname
    ).toBeNull()
    expect(gelesen(fundMit({ autor_vorname: '' })).kuerzungen).toEqual([])
  })

  it('ordnet anonyme Einträge einander nie zu', () => {
    const fund = gelesen(
      fundMit({ autor_art: 'anonym', autor_vorname: null, autor_ref: 'A' })
    )
    expect(fund.autor_ref).toBeNull()
    expect(fund.kuerzungen).toEqual([
      'Beitrag: autor_ref bei einem anonymen Eintrag – nicht übernommen'
    ])
  })

  it('übernimmt keinen Bildtext unter einem anderen Status als «gelesen»', () => {
    const fund = gelesen(
      fundMit({
        bilder: [
          {
            nr: 1,
            art: 'privatchat',
            text_status: 'zurueckgehalten',
            text: 'Hoi, hesch gseh …',
            text_abgeschnitten: false
          }
        ]
      })
    )
    expect(fund.bilder[0]!.text).toBeNull()
    expect(fund.kuerzungen).toEqual([
      'Bild 1: Text trotz text_status «zurueckgehalten» – nicht übernommen'
    ])
    expect(JSON.stringify(fund.kuerzungen)).not.toContain('Hoi')
  })

  it('liest den Text eines Privatchats oder Ausweises nie — auch nicht unter «gelesen»', () => {
    const fund = gelesen(
      fundMit({
        bilder: [
          {
            nr: 1,
            art: 'privatchat',
            text_status: 'gelesen',
            text: 'Hoi Sandra, mini Nummer isch 079 123 45 67',
            text_abgeschnitten: false
          },
          {
            nr: 2,
            art: 'ausweis_dokument',
            text_status: 'gelesen',
            text: 'Muster Sandra, geboren 1.1.1980',
            text_abgeschnitten: true
          },
          {
            nr: 3,
            art: 'privatchat',
            text_status: 'zurueckgehalten',
            text: null,
            text_abgeschnitten: false
          }
        ]
      })
    )
    expect(fund.bilder.map((b) => [b.text, b.text_status])).toEqual([
      [null, 'zurueckgehalten'],
      [null, 'zurueckgehalten'],
      [null, 'zurueckgehalten']
    ])
    expect(fund.bilder[1]!.text_abgeschnitten).toBe(false)
    expect(fund.kuerzungen).toEqual([
      'Bild 1: Text trotz art «privatchat» – nicht übernommen',
      'Bild 2: Text trotz art «ausweis_dokument» – nicht übernommen'
    ])
    const alles = JSON.stringify([fund.bilder, fund.kuerzungen])
    for (const verboten of ['Hoi', '079', 'Muster', '1980'])
      expect(alles).not.toContain(verboten)
  })

  it('lässt ein gelesenes Bild ohne Text aus', () => {
    const fund = gelesen(
      fundMit({
        bilder: [
          {
            nr: 1,
            art: 'flyer',
            text_status: 'gelesen',
            text: null,
            text_abgeschnitten: false
          }
        ]
      })
    )
    expect(fund.bilder).toEqual([])
    expect(fund.kuerzungen).toEqual([
      'Bild 1 ausgelassen: text fehlt trotz text_status «gelesen»'
    ])
  })

  it('nimmt einem geteilten Beitrag einer Privatperson Link und Quellenname, lässt ihm den Text', () => {
    const roh = rohFund(2)
    Object.assign(roh['geteilt'] as Record<string, unknown>, {
      autor_art: 'profil',
      autor_rolle: null,
      autor_name: 'Hans Beispielmann'
    })
    const fund = gelesen(roh)
    expect(fund.geteilt).toMatchObject({
      link: null,
      quelle_name: null,
      autor_name: null
    })
    expect(fund.geteilt?.text).toContain('Zeugenaufruf')
    expect(fund.kuerzungen).toEqual([
      'Geteilter Beitrag: autor_name ohne autor_rolle – nicht übernommen',
      'Geteilter Beitrag: link und quelle_name ohne autor_rolle – nicht übernommen'
    ])
  })

  it('nimmt einem entfernten Kommentar Wortlaut und Bilder, was immer die Tür noch schickt', () => {
    const roh = fundMit({})
    Object.assign((roh['kommentare'] as Record<string, unknown>[])[0]!, {
      stand: 'entfernt',
      text: 'steht noch da',
      bilder: [
        {
          nr: 1,
          art: 'foto',
          text_status: 'gelesen',
          text: 'x',
          text_abgeschnitten: false
        }
      ]
    })
    const fund = gelesen(roh)
    expect(fund.kommentare[0]).toMatchObject({
      stand: 'entfernt',
      text: null,
      bilder: []
    })
  })
})

describe('liesFund – der Grabstein', () => {
  it('trägt nie Inhalt weiter, auch wenn die Tür ihn mitschickt', () => {
    const ergebnis = liesFund({
      ...fundMit({}),
      status: 'entfernt',
      entfernt_grund: 'loeschbegehren'
    })
    expect(ergebnis.ok).toBe(true)
    if (!ergebnis.ok) return
    expect(Object.keys(ergebnis.fund).sort()).toEqual(
      [
        'aenderung',
        'entfernt_grund',
        'erstmals_freigegeben_am',
        'folge',
        'geaendert_am',
        'gemeinden_bfs',
        'kanal',
        'kennung',
        'quelle',
        'status'
      ].sort()
    )
    expect(JSON.stringify(ergebnis.fund)).not.toContain('Hauptstrasse')
  })

  it('geht an einer Formalie nicht verloren: kennung und folge genügen', () => {
    expect(
      liesFund({
        kennung: 'fb:1_2',
        folge: 9,
        status: 'entfernt',
        entfernt_grund: 'umzug',
        kanal: 'fax'
      })
    ).toEqual({
      ok: true,
      fund: {
        kennung: 'fb:1_2',
        folge: 9,
        status: 'entfernt',
        entfernt_grund: null,
        aenderung: [],
        erstmals_freigegeben_am: null,
        geaendert_am: null,
        kanal: null,
        quelle: null,
        gemeinden_bfs: []
      }
    })
  })

  it('ist ohne kennung oder folge ungültig', () => {
    expect(grund({ folge: 9, status: 'entfernt' })).toBe('kennung fehlt')
    expect(grund({ kennung: 'fb:1_2', status: 'entfernt' })).toMatch(/folge/)
  })
})

describe('liesQuellenAntwort', () => {
  const antwort = liesQuellenAntwort(fixture('quellen.json'))

  it('liest die Quellen und nennt die ungültige', () => {
    expect(antwort.freigabe.tag).toBe('2026-11-11')
    expect(antwort.quellen.map((q) => q.kennung)).toEqual([
      'fb-gruppe:1000000001',
      'fb-gruppe:1000000002',
      'fb-gruppe:99'
    ])
    expect(antwort.ungueltig).toEqual([
      { kennung: 'profil:12345', grund: 'art: unbekannter Wert «profil»' }
    ])
  })

  it('liest eine gelesene Quelle vollständig', () => {
    expect(antwort.quellen[0]).toEqual({
      kennung: 'fb-gruppe:1000000001',
      kanal: 'facebook',
      art: 'gruppe',
      name: 'Du bisch vo Musterdorf, wenn …',
      url: 'https://www.facebook.com/groups/1000000001',
      sichtbarkeit: 'oeffentlich',
      zugang: 'ohne_anmeldung',
      gemeinden_bfs: [2761],
      aktiv: true,
      stand: 'gelesen',
      zuletzt_vollstaendig_gelesen_am: '2026-11-11T11:12:00+01:00',
      gelesen_zurueck_bis: '2026-11-09T08:00:00+01:00',
      n_beitraege_gesehen: 14,
      n_aussortiert: 3,
      n_zu_alt: 1,
      fehler_seit: null,
      letzter_fehler: null,
      hinweise: [],
      kuerzungen: []
    })
  })

  it('unterscheidet die halb gelesene und die gescheiterte Quelle', () => {
    expect(antwort.quellen[1]).toMatchObject({
      sichtbarkeit: 'geschlossen',
      stand: 'teilweise',
      hinweise: ['Kommentare bei 4 Beiträgen nicht aufklappbar']
    })
    expect(antwort.quellen[2]).toMatchObject({
      stand: 'fehlgeschlagen',
      fehler_seit: '2026-11-09T11:05:00+01:00',
      letzter_fehler: 'Anmeldung abgelaufen',
      gemeinden_bfs: []
    })
  })

  it('übernimmt eine unbrauchbare Adresse nicht, kürzt den Namen und nennt eine doppelte Kennung', () => {
    const roh = fixture('quellen.json')
    const erste = (roh['quellen'] as Record<string, unknown>[])[0]!
    const ergebnis = liesQuellenAntwort({
      ...roh,
      quellen: [
        { ...erste, url: 'facebook.com/groups/1', name: 'n'.repeat(260) },
        erste,
        5
      ]
    })
    expect(ergebnis.quellen).toHaveLength(1)
    expect(ergebnis.quellen[0]).toMatchObject({ url: null })
    expect(ergebnis.quellen[0]!.name).toHaveLength(255)
    expect(ergebnis.quellen[0]!.kuerzungen).toEqual([
      'url ist keine verwendbare https-Adresse – nicht übernommen',
      'name gekürzt: 260 Zeichen, Grenze 255'
    ])
    expect(ergebnis.ungueltig).toEqual([
      { kennung: 'fb-gruppe:1000000001', grund: 'kennung kommt zweimal vor' },
      { kennung: null, grund: 'kein Objekt' }
    ])
  })

  it('verweigert einen fremden Umschlag', () => {
    expect(() =>
      liesQuellenAntwort({
        format: FORMAT,
        freigabe: fixture('quellen.json')['freigabe']
      })
    ).toThrow(/quellen/)
    expect(() =>
      liesQuellenAntwort({ ...fixture('quellen.json'), format: 'x' })
    ).toThrow(AntwortFormatFehler)
  })
})
