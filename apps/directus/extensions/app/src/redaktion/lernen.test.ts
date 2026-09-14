import { describe, expect, it } from 'vitest'
import {
  automatikPausieren,
  automatischeWeitergabe,
  belegErgaenzung,
  buildLernPrompt,
  LERN_SYSTEM_PROMPT,
  lohntLernen,
  MAX_BELEG,
  parseLernUrteil,
  regelFelder,
  regelnBlock,
  SICHTUNGSREGELN_UEBERSCHRIFT,
  vorgabenZeilen,
  type LernFall,
  type NummerierteRegel
} from './lernen'

describe('regelnBlock', () => {
  it('nummeriert die Regeln, damit eine Antwort sie zitieren kann', () => {
    const { text, nummern } = regelnBlock(
      [
        { id: 'a', regel: 'Keine Vereinsjubilaeen ohne besondere Zutaten.' },
        { id: 'b', regel: 'Leserbriefe zu Bauprojekten an die Chefredaktion.' }
      ],
      SICHTUNGSREGELN_UEBERSCHRIFT
    )

    expect(text.split('\n')).toEqual([
      SICHTUNGSREGELN_UEBERSCHRIFT,
      'R1: Keine Vereinsjubilaeen ohne besondere Zutaten.',
      'R2: Leserbriefe zu Bauprojekten an die Chefredaktion.'
    ])
    expect(nummern.get('R2')?.id).toBe('b')
    expect(nummern.has('R3')).toBe(false)
  })

  it('ist ohne Regeln leer — kein Block ohne Inhalt', () => {
    const { text, nummern } = regelnBlock([], SICHTUNGSREGELN_UEBERSCHRIFT)
    expect(text).toBe('')
    expect(nummern.size).toBe(0)
  })
})

describe('vorgabenZeilen', () => {
  it('rendert die Textregeln in der Form, die der Statistik-Prompt kennt', () => {
    expect(
      vorgabenZeilen(['Keine Ausrufezeichen.', 'Nenne den Bezirk.'])
    ).toEqual([
      '',
      'Redaktionelle Vorgaben:',
      '- Keine Ausrufezeichen.',
      '- Nenne den Bezirk.'
    ])
  })

  it('fuegt ohne Regeln nichts ein', () => {
    expect(vorgabenZeilen([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------

function fall(ueber: Partial<LernFall> = {}): LernFall {
  return {
    tisch: 'presseschau',
    quelleName: 'Binninger Wochenblatt',
    titel: 'Turnverein feiert 100 Jahre',
    merkmal: 'vereinsleben',
    zusammenfassung:
      'Der TV Binningen feiert im Oktober sein Jubilaeum mit einem Fest.',
    modellBegruendung: 'Vereinsjubilaeum, exklusiv im Blatt.',
    entscheid: 'abgelehnt',
    grund: 'nicht_relevant',
    kommentar: null,
    ...ueber
  }
}

describe('lohntLernen', () => {
  // Doublette, veraltet und falsche Gemeinde sagen etwas ueber Zeitpunkt und
  // Zuordnung — nie ueber eine Klasse von Beitraegen.
  it('lernt nie aus Doublette, veraltet oder falscher Gemeinde', () => {
    for (const grund of ['doublette', 'veraltet', 'falsche_gemeinde']) {
      expect(
        lohntLernen(fall({ grund, kommentar: 'sogar mit Kommentar' }), 5)
      ).toBe(false)
    }
  })

  it('ein Kommentar reicht — Worte sind die Redaktion, die sich erklaert', () => {
    expect(
      lohntLernen(
        fall({ kommentar: 'Vereinsjubilaeen interessieren uns nicht' }),
        0
      )
    ).toBe(true)
  })

  it('ein blosser Klick braucht zwei gleichgerichtete Vorgaenger', () => {
    expect(lohntLernen(fall(), 1)).toBe(false)
    expect(lohntLernen(fall(), 2)).toBe(true)
  })
})

describe('buildLernPrompt', () => {
  it('nennt Beitrag, Entscheid, Kommentar, Regeln und die Vorgaenger', () => {
    const prompt = buildLernPrompt(
      fall({ kommentar: 'ohne Zutaten' }),
      'Regeln:\nR1: Kirchenzettel nie.',
      ['Frauenverein 75 Jahre', 'Schuetzen 125 Jahre']
    )
    expect(prompt).toContain('Tisch: Wochenblaetter (Presseschau)')
    expect(prompt).toContain(
      'Beitrag: "Turnverein feiert 100 Jahre" (vereinsleben)'
    )
    expect(prompt).toContain('Entscheid der Redaktion: abgelehnt')
    expect(prompt).toContain('Grund: nicht_relevant')
    expect(prompt).toContain('Kommentar der Redaktion: ohne Zutaten')
    expect(prompt).toContain('R1: Kirchenzettel nie.')
    expect(prompt).toContain('Fruehere gleichgerichtete Entscheide (2):')
    expect(prompt).toContain('- "Schuetzen 125 Jahre"')
  })

  it('sagt, wenn es noch keine Regeln und keine Vorgaenger gibt', () => {
    const prompt = buildLernPrompt(fall(), '', [])
    expect(prompt).toContain('Bisher gibt es keine Regeln fuer diesen Tisch.')
    expect(prompt).toContain('Fruehere gleichgerichtete Entscheide: keine.')
  })

  it('verlangt im System-Prompt: im Zweifel einmalig', () => {
    expect(LERN_SYSTEM_PROMPT).toContain('Im Zweifel einmalig')
  })
})

describe('parseLernUrteil', () => {
  const nummern = new Map<string, NummerierteRegel>([
    [
      'R1',
      { nummer: 'R1', id: 'regel-1', regel: 'Kirchenzettel nie vorschlagen.' }
    ]
  ])
  const kontext = {
    nummern,
    entscheid: 'abgelehnt' as const,
    kommentar: null,
    gleichgerichtet: 0
  }

  it('stuft "neu" ohne Worte und ohne Wiederholung auf einmalig zurueck', () => {
    const urteil = parseLernUrteil(
      {
        urteil: 'neu',
        regel_nr: null,
        regel: 'Vereinsjubilaeen nicht vorschlagen.',
        wirkung: 'hinweis'
      },
      kontext
    )
    expect(urteil.urteil).toBe('einmalig')
  })

  it('nimmt "neu" mit Kommentar oder mit zwei Vorgaengern an', () => {
    const mitKommentar = parseLernUrteil(
      {
        urteil: 'neu',
        regel_nr: null,
        regel: 'Vereinsjubilaeen nicht vorschlagen.',
        wirkung: 'hinweis'
      },
      { ...kontext, kommentar: 'ohne Zutaten' }
    )
    expect(mitKommentar).toEqual({
      urteil: 'neu',
      regelId: null,
      regel: 'Vereinsjubilaeen nicht vorschlagen.',
      wirkung: 'hinweis'
    })
    const wiederholt = parseLernUrteil(
      {
        urteil: 'neu',
        regel_nr: null,
        regel: 'Vereinsjubilaeen nicht vorschlagen.',
        wirkung: 'hinweis'
      },
      { ...kontext, gleichgerichtet: 2 }
    )
    expect(wiederholt.urteil).toBe('neu')
  })

  it('erlaubt "weiterreichen" nur nach einem Weiterreichen', () => {
    const nachAblehnen = parseLernUrteil(
      {
        urteil: 'neu',
        regel_nr: null,
        regel: 'Leserbriefe an die Chefredaktion.',
        wirkung: 'weiterreichen'
      },
      { ...kontext, kommentar: 'x' }
    )
    expect(nachAblehnen.wirkung).toBe('hinweis')

    const nachWeiterreichen = parseLernUrteil(
      {
        urteil: 'neu',
        regel_nr: null,
        regel: 'Leserbriefe an die Chefredaktion.',
        wirkung: 'weiterreichen'
      },
      { ...kontext, entscheid: 'weitergereicht', kommentar: 'erst pruefen' }
    )
    expect(nachWeiterreichen.wirkung).toBe('weiterreichen')
  })

  it('loest eine zitierte Nummer zur Regel auf — und eine unbekannte wird einmalig', () => {
    expect(
      parseLernUrteil(
        {
          urteil: 'abgedeckt',
          regel_nr: 'R1',
          regel: null,
          wirkung: 'hinweis'
        },
        kontext
      )
    ).toEqual({
      urteil: 'abgedeckt',
      regelId: 'regel-1',
      regel: 'Kirchenzettel nie vorschlagen.',
      wirkung: 'hinweis'
    })
    expect(
      parseLernUrteil(
        {
          urteil: 'abgedeckt',
          regel_nr: 'R7',
          regel: null,
          wirkung: 'hinweis'
        },
        kontext
      ).urteil
    ).toBe('einmalig')
  })

  it('weist eine Antwort zurueck, die kein Objekt ist', () => {
    expect(() => parseLernUrteil('nein', kontext)).toThrow()
  })
})

describe('regelFelder', () => {
  it('legt eine Sichtungsregel global an ihrem Tisch an, mit den Worten des Editors als Beleg', () => {
    const felder = regelFelder(
      {
        urteil: 'neu',
        regelId: null,
        regel: 'Vereinsjubilaeen ohne Zutaten nicht vorschlagen.',
        wirkung: 'hinweis'
      },
      fall({ kommentar: 'ohne besondere Zutaten' }),
      []
    )
    expect(felder).toMatchObject({
      regel: 'Vereinsjubilaeen ohne Zutaten nicht vorschlagen.',
      geltungsbereich: 'global',
      herkunft: 'kommentar',
      aktiv: true,
      bereich: 'presseschau',
      stufe: 'sichtung',
      wirkung: 'hinweis',
      datensatz: null,
      quelle: null
    })
    expect(felder?.['beleg']).toContain(
      '"Turnverein feiert 100 Jahre" (Binninger Wochenblatt — abgelehnt, nicht_relevant)'
    )
    expect(felder?.['beleg']).toContain('ohne besondere Zutaten')
  })

  it('nennt bei einer abgeleiteten Regel die Entscheide, aus denen sie stammt', () => {
    const felder = regelFelder(
      { urteil: 'neu', regelId: null, regel: 'X.', wirkung: 'hinweis' },
      fall(),
      ['Frauenverein 75 Jahre', 'Schuetzen 125 Jahre']
    )
    expect(felder?.['herkunft']).toBe('entscheid')
    expect(felder?.['beleg']).toContain(
      'Abgeleitet aus 3 gleichgerichteten Entscheiden'
    )
    expect(felder?.['beleg']).toContain('"Schuetzen 125 Jahre"')
  })

  it('gibt fuer einmalig und abgedeckt nichts zurueck', () => {
    expect(
      regelFelder(
        { urteil: 'einmalig', regelId: null, regel: null, wirkung: 'hinweis' },
        fall(),
        []
      )
    ).toBeNull()
    expect(
      regelFelder(
        { urteil: 'abgedeckt', regelId: 'r', regel: 'x', wirkung: 'hinweis' },
        fall(),
        []
      )
    ).toBeNull()
  })
})

describe('belegErgaenzung', () => {
  it('haengt einen weiteren Beleg als Zeile an', () => {
    const neu = belegErgaenzung(
      '„ohne Zutaten" — zu "Turnverein" (abgelehnt)',
      fall({ titel: 'Schuetzen 125 Jahre' })
    )
    expect(neu.split('\n')).toHaveLength(2)
    expect(neu).toContain('+ "Schuetzen 125 Jahre"')
  })

  it('deklariert die Kappung statt endlos zu wachsen', () => {
    const voll = 'x'.repeat(MAX_BELEG - 10)
    const gekappt = belegErgaenzung(voll, fall())
    expect(gekappt.endsWith('(… weitere Belege nicht aufgefuehrt)')).toBe(true)
    // Ein zweiter Beleg danach aendert nichts mehr.
    expect(belegErgaenzung(gekappt, fall())).toBe(gekappt)
  })
})

describe('automatischeWeitergabe', () => {
  const nummern = new Map<string, NummerierteRegel>([
    [
      'R1',
      {
        nummer: 'R1',
        id: 'regel-1',
        regel: 'Leserbriefe zu Bauprojekten an die Chefredaktion.'
      }
    ],
    [
      'R2',
      { nummer: 'R2', id: 'regel-2', regel: 'Kirchenzettel nie vorschlagen.' }
    ]
  ])
  const regeln = [
    { id: 'regel-1', stufe: 'sichtung', wirkung: 'weiterreichen' },
    { id: 'regel-2', stufe: 'sichtung', wirkung: 'hinweis' }
  ]

  it('handelt nur auf eine zitierte, scharf gestellte Sichtungsregel', () => {
    expect(
      automatischeWeitergabe(
        { empfehlung: 'weiterreichen', empfehlung_regel: 'R1' },
        nummern,
        regeln
      )?.id
    ).toBe('regel-1')
  })

  it('ignoriert eine Empfehlung ohne passende Regel — fail-closed', () => {
    // Regel nicht scharf gestellt.
    expect(
      automatischeWeitergabe(
        { empfehlung: 'weiterreichen', empfehlung_regel: 'R2' },
        nummern,
        regeln
      )
    ).toBeNull()
    // Nummer, die keine geladene Regel nennt.
    expect(
      automatischeWeitergabe(
        { empfehlung: 'weiterreichen', empfehlung_regel: 'R9' },
        nummern,
        regeln
      )
    ).toBeNull()
    // Keine Empfehlung.
    expect(
      automatischeWeitergabe(
        { empfehlung: null, empfehlung_regel: 'R1' },
        nummern,
        regeln
      )
    ).toBeNull()
    // Textregel statt Sichtungsregel.
    expect(
      automatischeWeitergabe(
        { empfehlung: 'weiterreichen', empfehlung_regel: 'R1' },
        nummern,
        [{ id: 'regel-1', stufe: 'text', wirkung: 'weiterreichen' }]
      )
    ).toBeNull()
  })
})

describe('automatikPausieren', () => {
  it('pausiert nach zwei Rueckweisungen nacheinander — Zurueckgegebenes zaehlt', () => {
    expect(automatikPausieren(['kein_hinweis', 'zurueckgegeben'])).toBe(true)
    expect(
      automatikPausieren(['kein_hinweis', 'kein_hinweis', 'brauchbar'])
    ).toBe(true)
  })

  it('pausiert nicht nach einer, und nicht, wenn die juengste brauchbar war', () => {
    expect(automatikPausieren(['kein_hinweis'])).toBe(false)
    expect(automatikPausieren(['brauchbar', 'kein_hinweis'])).toBe(false)
    expect(automatikPausieren([])).toBe(false)
  })
})
