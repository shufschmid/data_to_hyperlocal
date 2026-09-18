import { describe, expect, it } from 'vitest'
import {
  abstimmungsFakten,
  abstimmungsAttributionsWarnung,
  buildAbstimmungsPrompt,
  datengrundlageAbstimmung,
  mitQuelle,
  ohneQuelle,
  quelleZeile,
  stichfragenWarnungen,
  zahlWarnungenAbstimmung,
  type AbstimmungsFakten
} from './abstimmung'

const K3 = {
  voteId: '20260927_K3',
  datum: '2026-09-27',
  ebene: 'kanton' as const,
  titel:
    'Formulierte Gesetzesinitiative «Fairer Kompromiss bei der Mehrwertabgabe»',
  quelleUrl:
    'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a',
  teile: [
    {
      art: 'vorlage' as const,
      titel:
        'Formulierte Gesetzesinitiative «Fairer Kompromiss bei der Mehrwertabgabe»',
      url: 'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a',
      kanton: {
        ja: 40000,
        nein: 30000,
        prozentJa: 57.142857,
        beteiligung: 44.4,
        stimmberechtigte: 190000,
        leer: 500,
        ungueltig: 300,
        antwort: 'angenommen',
        gemeinden: 86
      }
    },
    {
      art: 'gegenvorschlag' as const,
      titel: 'Gegenvorschlag des Landrats vom 23. April 2026',
      url: 'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3b',
      kanton: {
        ja: 45000,
        nein: 25000,
        prozentJa: 64.285714,
        beteiligung: 44.1,
        stimmberechtigte: 190000,
        leer: 600,
        ungueltig: 300,
        antwort: 'angenommen',
        gemeinden: 86
      }
    },
    {
      art: 'stichfrage' as const,
      titel: 'Stichfrage zur Gesetzesinitiative',
      url: 'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3c',
      kanton: {
        ja: 30000,
        nein: 38000,
        prozentJa: 44.117647,
        beteiligung: 43.2,
        stimmberechtigte: 190000,
        leer: 900,
        ungueltig: 300,
        antwort: 'gegenvorschlag',
        gemeinden: 86
      }
    }
  ]
}

const GEMEINDE = {
  bfs: '2765',
  gemeinde: 'Binningen',
  ausgezaehlt: true,
  ergebnisse: [
    {
      art: 'vorlage' as const,
      antwort: 'angenommen',
      ja: 2100,
      nein: 1500,
      prozentJa: 58.3,
      beteiligung: 47.2,
      stimmberechtigte: 8000,
      leer: 40,
      ungueltig: 30
    },
    {
      art: 'gegenvorschlag' as const,
      antwort: 'angenommen',
      ja: 2300,
      nein: 1300,
      prozentJa: 63.9,
      beteiligung: 47.1,
      stimmberechtigte: 8000,
      leer: 45,
      ungueltig: 30
    },
    {
      art: 'stichfrage' as const,
      antwort: 'gegenvorschlag',
      ja: 1600,
      nein: 1900,
      prozentJa: 45.7,
      beteiligung: 46.3,
      stimmberechtigte: 8000,
      leer: 50,
      ungueltig: 30
    }
  ]
}

function fakten(
  aenderung: {
    gilt?: boolean
    grund?: string
    vergleich?: { datum: string; beteiligung: number } | null
  } = {}
): AbstimmungsFakten {
  return abstimmungsFakten({
    vorlage: K3,
    gemeinde: GEMEINDE,
    stichfrage: {
      gilt: aenderung.gilt ?? true,
      grund:
        aenderung.grund ??
        'Der Kanton hat Initiative und Gegenvorschlag angenommen; die Stichfrage entscheidet.'
    },
    vergleich:
      aenderung.vergleich === undefined
        ? { datum: '2026-06-14', beteiligung: 54.9 }
        : aenderung.vergleich
  })
}

describe('abstimmungsFakten', () => {
  it('haelt Gemeinde, Kanton und den letzten Abstimmungstag als Zahlen bereit', () => {
    const f = fakten()

    expect(f.gemeinde).toBe('Binningen')
    expect(f.datumText).toBe('27. September 2026')
    expect(f.teile).toHaveLength(3)
    expect(f.teile[0]?.gemeinde?.ja).toBe(2100)
    // Auf eine Nachkommastelle gerundet uebergeben — so steht es im Text.
    expect(f.teile[0]?.kanton?.prozentJa).toBe(57.1)
    expect(f.vergleich?.datumText).toBe('14. Juni 2026')
  })

  it('nennt jede Art beim deutschen Namen', () => {
    expect(fakten().teile.map((t) => t.artText)).toEqual([
      'Initiative',
      'Gegenvorschlag',
      'Stichfrage'
    ])
  })
})

describe('buildAbstimmungsPrompt', () => {
  it('stellt die Stichfrage als Tatsache hin, wenn sie gilt', () => {
    const prompt = buildAbstimmungsPrompt(fakten())

    expect(prompt).toContain('Stichfrage')
    expect(prompt).toContain('die Stichfrage entscheidet')
  })

  it('verbietet die Stichfrage im Text, wenn sie nichts entscheidet', () => {
    const prompt = buildAbstimmungsPrompt(
      fakten({
        gilt: false,
        grund:
          'Der Kanton hat nicht beide Vorlagen angenommen; die Stichfrage entscheidet nichts und ihre Zahlen sagen nichts.'
      })
    )

    expect(prompt).toContain('Die Stichfrage gehoert NICHT in den Text')
    // Ihre Zahlen werden gar nicht erst uebergeben.
    expect(prompt).not.toContain('1600')
  })

  it('sagt es, wenn es keine Kantonszahlen gibt, statt zu schweigen', () => {
    const ohneKanton = abstimmungsFakten({
      vorlage: {
        ...K3,
        teile: K3.teile.map((teil) => ({ ...teil, kanton: null }))
      },
      gemeinde: GEMEINDE,
      stichfrage: {
        gilt: false,
        grund: 'Der Kanton ist noch nicht fertig ausgezaehlt.'
      },
      vergleich: null
    })

    expect(buildAbstimmungsPrompt(ohneKanton)).toContain(
      'keine Vergleichszahlen'
    )
  })
})

describe('die Pruefungen', () => {
  it('meldet eine Stichfrage im Text, die nichts entscheidet', () => {
    const f = fakten({
      gilt: false,
      grund: 'Der Kanton hat nicht beide Vorlagen angenommen.'
    })

    expect(
      stichfragenWarnungen('Bei der Stichfrage lag der Gegenvorschlag vorn.', f)
    ).toHaveLength(1)
    expect(stichfragenWarnungen('Binningen sagte zweimal Ja.', f)).toEqual([])
  })

  it('schweigt zur Stichfrage, wenn sie gilt', () => {
    expect(
      stichfragenWarnungen(
        'Bei der Stichfrage gewann der Gegenvorschlag.',
        fakten()
      )
    ).toEqual([])
  })

  it('meldet, wenn der Text den Kanton nicht als Quelle nennt', () => {
    expect(
      abstimmungsAttributionsWarnung(
        'Binningen hat mit 58,3 Prozent Ja gestimmt.'
      )
    ).not.toBeNull()
    expect(
      abstimmungsAttributionsWarnung(
        'Nach dem amtlichen Ergebnis des Kantons Basel-Landschaft sagte Binningen Ja.'
      )
    ).toBeNull()
  })

  it('meldet jede Ziffer, die nicht uebergeben wurde', () => {
    const f = fakten()

    expect(
      zahlWarnungenAbstimmung('2100 Ja zu 1500 Nein, 58,3 Prozent.', f)
    ).toEqual([])
    expect(
      zahlWarnungenAbstimmung('Die Beteiligung lag bei 71,4 Prozent.', f)
    ).toHaveLength(1)
  })
})

describe('die Quellenzeile', () => {
  it('wird gebaut und traegt genau eine Adresse', () => {
    const zeile = quelleZeile(fakten())

    expect(zeile).toContain(
      'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a'
    )
    expect(zeile).toContain('27. September 2026')
    expect(zeile.match(/https?:\/\//g)).toHaveLength(1)
  })

  it('kommt vor einer Ueberarbeitung wieder herunter', () => {
    const text = mitQuelle('Ein Satz.', fakten())

    expect(ohneQuelle(text)).toBe('Ein Satz.')
  })
})

describe('datengrundlageAbstimmung', () => {
  it('haelt fest, worauf der Artikel steht', () => {
    const grundlage = datengrundlageAbstimmung(fakten())

    expect(grundlage['quelle']).toBe('abstimmung')
    expect(grundlage['url']).toBe(
      'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a'
    )
    expect(grundlage['vote_id']).toBe('20260927_K3')
  })
})
