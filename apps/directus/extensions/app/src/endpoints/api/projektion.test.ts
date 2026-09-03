import { describe, expect, it } from 'vitest'
import {
  buildSlugMap,
  gemeindeSlug,
  liste,
  projektion,
  quelleVon,
  rubrikVon,
  statistikUrl,
  type Rohzeile
} from './projektion'

// Die datengrundlage-Formen unten sind aus den Schreibstellen kopiert
// (redaktion/drain.ts, spielberichte.ts, erinnerung.ts und die drei Bloecke in
// endpoints/redaktion/index.ts) — nicht erfunden. Aendert eine Schreibstelle
// ihre Schluessel, soll hier etwas rot werden.

function zeile(ueber: Partial<Rohzeile> = {}): Rohzeile {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    titel: 'Ein Titel',
    lead: 'Ein Lead.',
    text: 'Ein Text.',
    publiziert_am: '2026-09-01T06:30:00.000Z',
    erscheint_am: null,
    perle: null,
    lauf: null,
    kandidat: null,
    sendungskandidat: null,
    amtsblattmeldung: null,
    spiel: null,
    gemeinde: { id: 'g-1', name: 'Münchenstein', bfs_nummer: 2769 },
    datengrundlage: null,
    ...ueber
  }
}

describe('gemeindeSlug', () => {
  // Muss byte-gleich zum Frontend bleiben (apps/front/src/lib/redaktion.ts):
  // der Blog verlinkt mit diesen Kennungen, und ein auseinanderlaufender Slug
  // braeche beide Seiten auf einmal.
  it('schreibt Umlaute aus, wie es die Schweiz tut', () => {
    expect(gemeindeSlug('Münchenstein')).toBe('muenchenstein')
    expect(gemeindeSlug('Aesch')).toBe('aesch')
    expect(gemeindeSlug('Röschenz')).toBe('roeschenz')
    expect(gemeindeSlug('Läufelfingen')).toBe('laeufelfingen')
  })

  it('macht aus allem anderen einen Bindestrich und raeumt die Raender', () => {
    expect(gemeindeSlug('Basel-Stadt')).toBe('basel-stadt')
    expect(gemeindeSlug('Sankt Pantaleon')).toBe('sankt-pantaleon')
    expect(gemeindeSlug(' Riehen ')).toBe('riehen')
  })
})

describe('buildSlugMap', () => {
  it('findet die Gemeinde zu ihrer Kennung', () => {
    const karte = buildSlugMap([
      {
        id: 'g-1',
        name: 'Münchenstein',
        bfs_nummer: 2769,
        bezirk: 'Arlesheim'
      },
      { id: 'g-2', name: 'Riehen', bfs_nummer: 2703, bezirk: 'Basel-Stadt' }
    ])
    expect(karte.get('muenchenstein')?.id).toBe('g-1')
    expect(karte.get('riehen')?.bfs_nummer).toBe(2703)
    expect(karte.get('muttenz')).toBeUndefined()
  })
})

describe('rubrikVon', () => {
  it('erkennt jede der sechs Arten an ihrem Merkmal', () => {
    expect(rubrikVon(zeile({ lauf: 'l-1' }))).toBe('statistik')
    expect(
      rubrikVon(
        zeile({
          spiel: {
            sportart: 'fussball',
            wettbewerb: null,
            heim: null,
            gast: null,
            tore_heim: null,
            tore_gast: null,
            datum: null
          }
        })
      )
    ).toBe('sport')
    expect(rubrikVon(zeile({ erscheint_am: '2026-09-04' }))).toBe('entsorgung')
    expect(rubrikVon(zeile({ kandidat: 'k-1' }))).toBe('presseschau')
    expect(rubrikVon(zeile({ sendungskandidat: 's-1' }))).toBe('sendung')
  })

  // Die Unterscheidung amtsblatt/beschaffung kommt aus der RELATION: der
  // Gazette-Tisch schreibt datengrundlage.quelle hart auf 'amtsblatt', auch
  // fuer simap-Zeilen.
  it('trennt Amtsblatt und Beschaffung an der Relation, nicht an der datengrundlage', () => {
    expect(
      rubrikVon(
        zeile({
          amtsblattmeldung: { quelle_typ: 'simap' },
          datengrundlage: { quelle: 'amtsblatt' }
        })
      )
    ).toBe('beschaffung')
    expect(
      rubrikVon(zeile({ amtsblattmeldung: { quelle_typ: 'amtsblatt' } }))
    ).toBe('amtsblatt')
    // Zeilen von vor der simap-Erweiterung tragen null.
    expect(rubrikVon(zeile({ amtsblattmeldung: { quelle_typ: null } }))).toBe(
      'amtsblatt'
    )
  })

  it('sagt null, statt eine Rubrik zu erfinden', () => {
    expect(rubrikVon(zeile())).toBeNull()
  })
})

describe('statistikUrl', () => {
  // Korrektur aus den echten Daten: die Adresse steht NICHT im Text. Gemessen
  // an den publizierten Statistik-Meldungen schreibt das Modell oft gar keine
  // Quellenzeile — der Text endet mit der Prosa. Die Adresse kommt darum aus
  // dem Datensatz hinter dem Lauf, gebaut von derselben Funktion, gegen die
  // die Redaktion ihre eigenen Artikel prueft.
  it('baut die Adresse des Portals aus der externen Kennung', () => {
    expect(
      statistikUrl({
        datensatz: {
          externe_id: '12060',
          quelle: { typ: 'ods' },
          ankuendigung: null
        }
      })
    ).toBe('https://data.bl.ch/explore/dataset/12060/')

    expect(
      statistikUrl({
        datensatz: {
          externe_id: 'wohnen-leerstand',
          quelle: { typ: 'statbl' },
          ankuendigung: null
        }
      })
    ).toBe('https://statistik.bl.ch/web_portal/wohnen-leerstand')
  })

  it('nimmt den Webartikel des Amtes, wo die Agenda einen verlinkt', () => {
    expect(
      statistikUrl({
        datensatz: {
          externe_id: '12060',
          quelle: { typ: 'ods' },
          ankuendigung: {
            link: 'https://www.baselland.ch/webartikel/leerstand-2026'
          }
        }
      })
    ).toBe('https://www.baselland.ch/webartikel/leerstand-2026')
  })

  it('sagt nichts, wo es nichts ehrlich zu sagen gibt', () => {
    expect(statistikUrl(null)).toBeNull()
    expect(statistikUrl('nur-eine-uuid')).toBeNull()
    expect(statistikUrl({ datensatz: null })).toBeNull()
    expect(
      statistikUrl({
        datensatz: {
          externe_id: null,
          quelle: { typ: 'ods' },
          ankuendigung: null
        }
      })
    ).toBeNull()
    // Ein Quellentyp, fuer den es keine bekannte Adressform gibt.
    expect(
      statistikUrl({
        datensatz: {
          externe_id: '12060',
          quelle: { typ: 'agenda' },
          ankuendigung: null
        }
      })
    ).toBeNull()
  })
})

describe('quelleVon', () => {
  it('Statistik: das Amt und die Adresse aus dem Datensatz', () => {
    const q = quelleVon(
      zeile({
        lauf: {
          datensatz: {
            externe_id: '12060',
            quelle: { typ: 'ods' },
            ankuendigung: null
          }
        },
        // drain.ts schreibt hier KEINEN quelle-Schluessel, sondern Rohzeilen.
        datengrundlage: { periode: '2025', zeilen_gesamt: 86, zeilen: [] }
      }),
      'statistik'
    )
    expect(q.name).toBe('Statistisches Amt Basel-Landschaft')
    expect(q.url).toBe('https://data.bl.ch/explore/dataset/12060/')
  })

  it('Sport: benannt, aber ohne Adresse — es gibt keine stabile', () => {
    const q = quelleVon(
      zeile({
        spiel: {
          sportart: 'fussball',
          wettbewerb: '2. Liga',
          heim: 'A',
          gast: 'B',
          tore_heim: 2,
          tore_gast: 1,
          datum: '2026-08-29T16:00:00.000Z'
        },
        datengrundlage: { quelle: 'matchcenter', heim: 'A', gast: 'B' }
      }),
      'sport'
    )
    expect(q.name).toBe('Match-Center')
    // Die Tagesseite des Verbands rotiert — eine Adresse hier waere in einer
    // Woche falsch. null ist die ehrliche Antwort (R11).
    expect(q.url).toBeNull()
  })

  it('Entsorgung: Kalender mit Jahr, Adresse aus der Registrierung', () => {
    const q = quelleVon(
      zeile({
        erscheint_am: '2026-09-04',
        datengrundlage: {
          quelle: 'abfuhrkalender',
          gemeinde: 'Riehen',
          jahr: 2026,
          quellen: ['https://www.riehen.ch/abfuhrkalender-2026.pdf']
        }
      }),
      'entsorgung'
    )
    expect(q.name).toBe('Abfuhrkalender Riehen 2026')
    expect(q.url).toBe('https://www.riehen.ch/abfuhrkalender-2026.pdf')
  })

  it('Entsorgung: ohne registrierte Adresse bleibt die Adresse leer', () => {
    // Ein als Datei hochgeladener Kalender hat keine oeffentliche Adresse —
    // und die Directus-Datei ist keine.
    const q = quelleVon(
      zeile({
        erscheint_am: '2026-09-04',
        datengrundlage: {
          quelle: 'abfuhrkalender',
          gemeinde: 'Aesch',
          jahr: 2026,
          quellen: []
        }
      }),
      'entsorgung'
    )
    expect(q.name).toBe('Abfuhrkalender Aesch 2026')
    expect(q.url).toBeNull()
  })

  it('Amtsblatt: das Amt und das amtliche PDF', () => {
    const q = quelleVon(
      zeile({
        amtsblattmeldung: { quelle_typ: 'amtsblatt' },
        datengrundlage: {
          quelle: 'amtsblatt',
          amt: 'Kanton Basel-Landschaft - Bauinspektorat',
          pdf_url: 'https://amtsblattportal.ch/api/v1/publications/4dc2b146/pdf'
        }
      }),
      'amtsblatt'
    )
    expect(q.name).toBe('Kanton Basel-Landschaft - Bauinspektorat')
    expect(q.url).toBe(
      'https://amtsblattportal.ch/api/v1/publications/4dc2b146/pdf'
    )
  })

  it('Amtsblatt ohne Amt: eine ehrliche Ersatzbezeichnung', () => {
    const q = quelleVon(
      zeile({
        amtsblattmeldung: { quelle_typ: null },
        datengrundlage: {
          quelle: 'amtsblatt',
          pdf_url: 'https://amtsblattportal.ch/x'
        }
      }),
      'amtsblatt'
    )
    expect(q.name).toBe('Amtliche Publikation')
  })

  it('Beschaffung: die Plattform und die Projektseite', () => {
    const q = quelleVon(
      zeile({
        amtsblattmeldung: { quelle_typ: 'simap' },
        datengrundlage: {
          quelle: 'amtsblatt',
          amt: 'Gemeinde Pratteln',
          pdf_url: 'https://www.simap.ch/de/project-detail/abc'
        }
      }),
      'beschaffung'
    )
    expect(q.name).toBe('simap.ch')
    expect(q.url).toBe('https://www.simap.ch/de/project-detail/abc')
  })

  it('Presseschau: das Blatt und die Seite im PDF', () => {
    const q = quelleVon(
      zeile({
        kandidat: 'k-1',
        datengrundlage: {
          quelle: 'wochenblatt',
          blatt: 'Binninger Wochenblatt',
          nummer: '36',
          seite: 7,
          pdf_url: 'https://www.binninger-wochenblatt.ch/ausgabe-36.pdf'
        }
      }),
      'presseschau'
    )
    expect(q.name).toBe('Binninger Wochenblatt')
    // seitenLink haengt die Seite an, wie der jeweilige Leser sie versteht.
    expect(q.url).toBe(
      'https://www.binninger-wochenblatt.ch/ausgabe-36.pdf#page=7'
    )
  })

  it('Presseschau ohne Seite: das PDF allein', () => {
    const q = quelleVon(
      zeile({
        kandidat: 'k-1',
        datengrundlage: {
          quelle: 'wochenblatt',
          blatt: 'BiBo',
          seite: null,
          pdf_url: 'https://bibo.ch/x.pdf'
        }
      }),
      'presseschau'
    )
    expect(q.url).toBe('https://bibo.ch/x.pdf')
  })

  it('Sendung: der Deeplink wird gebaut, je Sender anders', () => {
    // quell_url ist OHNE Zeitmarke gespeichert; SRFs Podcast nimmt #t=,
    // telebasels Seite ?t= (Spiegel von redaktion/sendung.ts).
    const rj = quelleVon(
      zeile({
        sendungskandidat: 's-1',
        datengrundlage: {
          quelle: 'regionaljournal',
          sendung: 'Regionaljournal Basel Baselland',
          zeitmarke_sekunden: 709,
          quell_url: 'https://srf.ch/audio/xyz.mp3'
        }
      }),
      'sendung'
    )
    expect(rj.name).toBe('Regionaljournal Basel Baselland')
    expect(rj.url).toBe('https://srf.ch/audio/xyz.mp3#t=709')

    const p6 = quelleVon(
      zeile({
        sendungskandidat: 's-2',
        datengrundlage: {
          quelle: 'punkt6',
          sendung: 'punkt6',
          zeitmarke_sekunden: 277.4,
          quell_url: 'https://telebasel.ch/sendungen/punkt6/239531'
        }
      }),
      'sendung'
    )
    expect(p6.url).toBe('https://telebasel.ch/sendungen/punkt6/239531?t=277')
  })

  it('Sendung ohne brauchbare Marke: die nackte Adresse', () => {
    for (const marke of [0, null, undefined]) {
      const q = quelleVon(
        zeile({
          sendungskandidat: 's-1',
          datengrundlage: {
            quelle: 'punkt6',
            sendung: 'punkt6',
            zeitmarke_sekunden: marke,
            quell_url: 'https://telebasel.ch/x'
          }
        }),
        'sendung'
      )
      expect(q.url, `marke=${marke}`).toBe('https://telebasel.ch/x')
    }
  })

  it('vertraegt eine datengrundlage, die nicht ist, was sie sein sollte', () => {
    for (const kaputt of [null, 'text', 42, []]) {
      expect(() =>
        quelleVon(
          zeile({ kandidat: 'k-1', datengrundlage: kaputt }),
          'presseschau'
        )
      ).not.toThrow()
    }
  })
})

describe('projektion', () => {
  it('liefert die ganze Form, mit Kennung und Rubrik', () => {
    const artikel = projektion(
      zeile({
        lauf: {
          datensatz: {
            externe_id: '12060',
            quelle: { typ: 'ods' },
            ankuendigung: null
          }
        }
      })
    )

    expect(artikel.gemeinde).toBe('muenchenstein')
    expect(artikel.gemeinde_name).toBe('Münchenstein')
    expect(artikel.bfs_nummer).toBe(2769)
    expect(artikel.rubrik).toBe('statistik')
    expect(artikel.publiziert_am).toBe('2026-09-01T06:30:00.000Z')
    expect(artikel.quelle_url).toBe('https://data.bl.ch/explore/dataset/12060/')
    expect(artikel.sport).toBeNull()
  })

  // Der Grund, warum diese Schnittstelle rechnet und nicht Directus' eigene
  // Tuer benutzt wird: datengrundlage ist Arbeitsmaterial. Bei einer
  // Statistik-Meldung stehen dort bis zu sechzig Rohzeilen des Datensatzes.
  it('gibt die datengrundlage NIE heraus', () => {
    const artikel = projektion(
      zeile({
        lauf: 'l-1',
        datengrundlage: { periode: '2025', zeilen: [{ geheim: 'wert' }] }
      })
    )
    expect(Object.keys(artikel)).not.toContain('datengrundlage')
    expect(JSON.stringify(artikel)).not.toContain('geheim')
  })

  it('macht aus einer fehlenden Perle ein Nein, nicht ein Vielleicht', () => {
    expect(projektion(zeile({ perle: null })).perle).toBe(false)
    expect(projektion(zeile({ perle: true })).perle).toBe(true)
  })

  it('legt bei Sport das Resultat daneben', () => {
    const artikel = projektion(
      zeile({
        spiel: {
          sportart: 'fussball',
          wettbewerb: '2. Liga interregional',
          heim: 'SC Binningen',
          gast: 'FC Muttenz',
          tore_heim: 2,
          tore_gast: 2,
          datum: '2026-08-29T16:00:00.000Z'
        }
      })
    )
    expect(artikel.rubrik).toBe('sport')
    expect(artikel.sport).toEqual({
      sportart: 'fussball',
      wettbewerb: '2. Liga interregional',
      heim: 'SC Binningen',
      gast: 'FC Muttenz',
      tore_heim: 2,
      tore_gast: 2,
      datum: '2026-08-29T16:00:00.000Z'
    })
  })

  it('liefert Zeitstempel in UTC, was auch hereinkommt', () => {
    expect(
      projektion(zeile({ publiziert_am: '2026-09-01T08:30:00+02:00' }))
        .publiziert_am
    ).toBe('2026-09-01T06:30:00.000Z')
  })

  it('vertraegt eine Meldung ohne Gemeinde, statt zu werfen', () => {
    const artikel = projektion(zeile({ gemeinde: null }))
    expect(artikel.gemeinde).toBeNull()
    expect(artikel.gemeinde_name).toBeNull()
  })
})

describe('liste', () => {
  it('zaehlt, was geliefert wurde, und sagt, ob mehr da ist', () => {
    expect(
      liste('artikel', [1, 2], { gesamt: 5, versatz: 0, grenze: 2 })
    ).toEqual({
      anzahl: 2,
      gesamt: 5,
      versatz: 0,
      grenze: 2,
      weitere: true,
      artikel: [1, 2]
    })
  })

  it('sagt am Ende, dass nichts mehr kommt', () => {
    const letzte = liste('artikel', [5], { gesamt: 5, versatz: 4, grenze: 2 })
    expect(letzte['weitere']).toBe(false)
    // Und hinter dem Ende bleibt gesamt stehen, damit ein Abnehmer merkt,
    // dass er zu weit geblaettert hat.
    const dahinter = liste('artikel', [], { gesamt: 5, versatz: 99, grenze: 2 })
    expect(dahinter['anzahl']).toBe(0)
    expect(dahinter['gesamt']).toBe(5)
    expect(dahinter['weitere']).toBe(false)
  })
})
