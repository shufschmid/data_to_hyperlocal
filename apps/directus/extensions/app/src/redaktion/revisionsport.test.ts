import { describe, expect, it } from 'vitest'
import {
  revisionsBefundSpiel,
  revisionsSchreibungenSpiel,
  type RevisionsSpiel,
  type RevisionsSpielMeldung,
  type SpielStand
} from './revisionsport'

// The match as the source now has it. Only digits that really appear in the
// facts may stand in these strings — the imported check reads them.
const NEU: RevisionsSpiel = {
  heim: 'FC Binningen',
  gast: 'FC Basel',
  tore_heim: 2,
  tore_gast: 1,
  datum: '2026-09-12T18:00:00.000Z',
  wettbewerb: '2. Liga interregional',
  ort: null
}

/** The same match before the association touched it: a 1:1 that became a 2:1. */
const ALT: SpielStand = {
  tore_heim: 1,
  tore_gast: 1,
  datum: NEU.datum
}

const UNVERAENDERT: SpielStand = {
  tore_heim: 2,
  tore_gast: 1,
  datum: NEU.datum
}

const JETZT = '2026-09-17T06:30:00.000Z'

const bericht = (text: string) => ({
  titel: 'Binningen spielt zu Hause',
  lead: null,
  text
})

describe('revisionsBefundSpiel', () => {
  it('schweigt, wenn Tore und Datum gleich blieben', () => {
    expect(
      revisionsBefundSpiel(
        bericht('Die Partie endete 2:1.'),
        UNVERAENDERT,
        NEU,
        JETZT
      )
    ).toBeNull()
  })

  it('nennt die Korrektur, wenn der Bericht noch das alte Resultat traegt', () => {
    expect(
      revisionsBefundSpiel(bericht('Die Partie endete 1:1.'), ALT, NEU, JETZT)
    ).toBe(
      'Der Verband hat das Resultat korrigiert: 2:1 statt 1:1 ' +
        '(Stand 17. September 2026). Der Bericht nennt noch das alte Resultat.'
    )
  })

  it('schweigt, wenn der Bericht die alten Zahlen gar nicht nennt', () => {
    expect(
      revisionsBefundSpiel(
        bericht('Der FC Binningen trennte sich unentschieden vom Gegner.'),
        ALT,
        NEU,
        JETZT
      )
    ).toBeNull()
  })

  it('schweigt bei einem Spiel ohne Bericht', () => {
    expect(
      revisionsBefundSpiel(
        { titel: null, lead: null, text: null },
        ALT,
        NEU,
        JETZT
      )
    ).toBeNull()
  })

  it('findet eine alte Zahl auch ausserhalb der Resultatschreibweise', () => {
    // Die Ziffernpruefung aus spielbericht.ts, importiert: "3" steht im neuen
    // Stand nirgends mehr, und der alte Stand trug sie.
    expect(
      revisionsBefundSpiel(
        bericht('Der Sieg fiel mit 3 Toren Vorsprung deutlich aus.'),
        { tore_heim: 3, tore_gast: 0, datum: NEU.datum },
        { ...NEU, tore_heim: 2, tore_gast: 0 },
        JETZT
      )
    ).toBe(
      'Der Verband hat das Resultat korrigiert: 2:0 statt 3:0 ' +
        '(Stand 17. September 2026). Der Bericht nennt noch das alte Resultat.'
    )
  })

  it('meldet ein verschobenes Spieldatum, das der Bericht noch nennt', () => {
    expect(
      revisionsBefundSpiel(
        bericht('Am 6. September 2026 endete die Partie 2:1.'),
        { tore_heim: 2, tore_gast: 1, datum: '2026-09-06T18:00:00.000Z' },
        NEU,
        JETZT
      )
    ).toBe(
      'Der Verband hat das Spieldatum verschoben: 12. September 2026 statt ' +
        '6. September 2026 (Stand 17. September 2026). Der Bericht nennt noch ' +
        'das alte Datum.'
    )
  })

  it('nennt Resultat und Datum zusammen, wenn beides wanderte', () => {
    expect(
      revisionsBefundSpiel(
        bericht('Am 6. September 2026 endete die Partie 1:1.'),
        { tore_heim: 1, tore_gast: 1, datum: '2026-09-06T18:00:00.000Z' },
        NEU,
        JETZT
      )
    ).toBe(
      'Der Verband hat das Resultat korrigiert: 2:1 statt 1:1 und das ' +
        'Spieldatum verschoben: 12. September 2026 statt 6. September 2026 ' +
        '(Stand 17. September 2026). Der Bericht nennt noch das alte Resultat ' +
        'und das alte Datum.'
    )
  })

  it('meldet ein zurueckgezogenes Resultat', () => {
    expect(
      revisionsBefundSpiel(
        bericht('Die Partie endete 1:1.'),
        ALT,
        { ...NEU, tore_heim: null, tore_gast: null },
        JETZT
      )
    ).toBe(
      'Der Verband hat das Resultat korrigiert: kein Resultat statt 1:1 ' +
        '(Stand 17. September 2026). Der Bericht nennt noch das alte Resultat.'
    )
  })
})

describe('revisionsSchreibungenSpiel', () => {
  const meldung = (
    id: string,
    text: string,
    hinweis: string | null = null
  ): RevisionsSpielMeldung => ({
    id,
    titel: 'Binningen spielt zu Hause',
    lead: null,
    text,
    revision_hinweis: hinweis
  })

  it('schreibt nichts, wenn kein Bericht auf das Spiel zeigt', () => {
    expect(revisionsSchreibungenSpiel([], ALT, NEU, JETZT)).toEqual([])
  })

  it('schreibt den Befund auf den betroffenen Bericht', () => {
    const schreibungen = revisionsSchreibungenSpiel(
      [meldung('m1', 'Die Partie endete 1:1.')],
      ALT,
      NEU,
      JETZT
    )
    expect(schreibungen).toHaveLength(1)
    expect(schreibungen[0]?.id).toBe('m1')
    expect(schreibungen[0]?.revision_hinweis).toContain('2:1 statt 1:1')
    expect(schreibungen[0]?.revision_geprueft_am).toBe(JETZT)
  })

  it('laesst einen Bericht in Ruhe, der schon denselben Befund traegt', () => {
    const hinweis =
      'Der Verband hat das Resultat korrigiert: 2:1 statt 1:1 ' +
      '(Stand 17. September 2026). Der Bericht nennt noch das alte Resultat.'
    expect(
      revisionsSchreibungenSpiel(
        [meldung('m1', 'Die Partie endete 1:1.', hinweis)],
        ALT,
        NEU,
        JETZT
      )
    ).toEqual([])
  })

  it('loescht einen Befund, der nicht mehr gilt', () => {
    // Der Verband korrigiert zurueck: das Spiel steht wieder 1:1, und der
    // Bericht, der 1:1 nennt, stimmt wieder.
    expect(
      revisionsSchreibungenSpiel(
        [meldung('m1', 'Die Partie endete 1:1.', 'Alter Befund.')],
        { tore_heim: 2, tore_gast: 1, datum: NEU.datum },
        { ...NEU, tore_heim: 1, tore_gast: 1 },
        JETZT
      )
    ).toEqual([
      { id: 'm1', revision_hinweis: null, revision_geprueft_am: JETZT }
    ])
  })
})
