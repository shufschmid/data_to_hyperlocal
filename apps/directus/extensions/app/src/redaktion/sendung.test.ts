import { describe, expect, it } from 'vitest'
import type { SendungsFakten } from './sendung'
import {
  attributionsWarnung,
  buildInventarPrompt,
  buildSendungPrompt,
  buildSendungRevision,
  darfWeg,
  gemeindeTreffer,
  INVENTAR_SYSTEM_PROMPT,
  lernDigest,
  mitQuelle,
  parseInventar,
  quelleZeile,
  zahlWarnungen
} from './sendung'

const GEMEINDEN = ['Aesch', 'Riehen', 'Binningen', 'Münchenstein', 'Pratteln']

describe('gemeindeTreffer', () => {
  it('findet die Gemeinde, egal in welcher Schreibung', () => {
    expect(
      gemeindeTreffer('Der Gemeinderat von Aesch hat entschieden.', GEMEINDEN)
    ).toEqual(['Aesch'])
    expect(gemeindeTreffer('in riehen wird gebaut', GEMEINDEN)).toEqual([
      'Riehen'
    ])
    expect(gemeindeTreffer('Münchenstein und Pratteln', GEMEINDEN)).toEqual([
      'Münchenstein',
      'Pratteln'
    ])
  })

  // Die lokale Falle, und sie ist der Grund fuer die Wortgrenzen: beides sind
  // Basler Stadtadressen, die in genau diesen zwei Sendungen staendig
  // vorkommen. Ein Teilstring-Treffer haette fast taeglich einen Kandidaten
  // fuer die falsche Gemeinde vorgeschlagen.
  it('faellt nicht auf Aeschenplatz und Riehenring herein', () => {
    expect(
      gemeindeTreffer('Am Aeschenplatz staut sich der Verkehr.', GEMEINDEN)
    ).toEqual([])
    expect(
      gemeindeTreffer('Die Messe am Riehenring ist ausgebucht.', GEMEINDEN)
    ).toEqual([])
    expect(gemeindeTreffer('An der Aeschenvorstadt 12.', GEMEINDEN)).toEqual([])
  })

  it('erkennt die Gemeinde trotzdem, wo sie wirklich steht', () => {
    expect(
      gemeindeTreffer('Vom Aeschenplatz nach Aesch fahren.', GEMEINDEN)
    ).toEqual(['Aesch'])
  })

  it('antwortet leer, wenn keine bespielte Gemeinde vorkommt', () => {
    expect(
      gemeindeTreffer(
        'Basel und Liestal streiten ueber die Steuern.',
        GEMEINDEN
      )
    ).toEqual([])
  })
})

describe('Inventar', () => {
  // Wie ueberall: was der Prompt-Cache traegt, darf sich nicht bewegen.
  it('haelt nichts Gemeindespezifisches im Systemprompt', () => {
    for (const wort of GEMEINDEN) {
      expect(INVENTAR_SYSTEM_PROMPT).not.toContain(wort)
    }
  })

  it('nennt im User-Turn nur die tatsaechlich gefundenen Gemeinden', () => {
    const prompt = buildInventarPrompt(
      {
        titel: 'Neues Schulhaus',
        text: 'Wortlaut …',
        sendung: 'regionaljournal',
        datum: '2026-08-31'
      },
      ['Aesch'],
      ''
    )

    expect(prompt).toContain(
      'Gemeinden der Redaktion, die im Text vorkommen: Aesch'
    )
    expect(prompt).toContain('Regionaljournal Basel Baselland vom 2026-08-31')
    expect(prompt).not.toContain('Riehen')
  })

  it('liest die Kandidaten mit ihren Fakten', () => {
    const kandidaten = parseInventar(
      {
        kandidaten: [
          {
            gemeinde: 'Aesch',
            titel: 'Schulhaus wird saniert',
            zusammenfassung: 'Kosten: 4 Millionen. Baubeginn 2027.',
            begruendung: 'Betrifft alle Familien im Dorf.'
          }
        ]
      },
      ['Aesch']
    )

    expect(kandidaten).toHaveLength(1)
    expect(kandidaten[0]?.gemeinde).toBe('Aesch')
    expect(kandidaten[0]?.zusammenfassung).toContain('4 Millionen')
  })

  // Dieselbe Regel wie bei der Presseschau: ein Kandidat unter einem Namen, den
  // die Redaktion nicht bespielt, wird VERWORFEN — nie auf die naechstgelegene
  // Gemeinde umgeschrieben.
  it('verwirft Kandidaten fremder Gemeinden, statt sie umzufilen', () => {
    const kandidaten = parseInventar(
      {
        kandidaten: [
          {
            gemeinde: 'Basel',
            titel: 'x',
            zusammenfassung: 'y',
            begruendung: 'z'
          },
          {
            gemeinde: 'Aesch',
            titel: 'a',
            zusammenfassung: 'b',
            begruendung: 'c'
          }
        ]
      },
      ['Aesch']
    )

    expect(kandidaten.map((k) => k.gemeinde)).toEqual(['Aesch'])
  })

  it('verwirft Kandidaten ohne Fakten — sie waeren die Grundlage der Meldung', () => {
    expect(
      parseInventar(
        {
          kandidaten: [
            {
              gemeinde: 'Aesch',
              titel: 'Titel',
              zusammenfassung: '  ',
              begruendung: ''
            }
          ]
        },
        ['Aesch']
      )
    ).toEqual([])
  })

  it('meldet eine unbrauchbare Antwort als Fehler', () => {
    expect(() => parseInventar({ nichts: true }, ['Aesch'])).toThrow(
      'kandidaten'
    )
  })
})

describe('lernDigest', () => {
  it('rendert die Entscheide als Beispiele', () => {
    const digest = lernDigest([
      {
        titel: 'Nur erwaehnt',
        gemeinde: 'Riehen',
        entscheid: 'abgelehnt',
        grund: 'nur_erwaehnt'
      },
      {
        titel: 'Schulhaus',
        gemeinde: 'Aesch',
        entscheid: 'uebernommen',
        grund: null
      }
    ])

    expect(digest).toContain(
      '[Riehen] "Nur erwaehnt" → nein (nur am Rand erwaehnt)'
    )
    expect(digest).toContain(
      '[Aesch] "Schulhaus" → ja, daraus wurde eine Meldung'
    )
  })

  it('bleibt bei den letzten zwanzig und leer ohne Entscheide', () => {
    const viele = Array.from({ length: 40 }, (_, i) => ({
      titel: `T${i}`,
      gemeinde: 'Aesch',
      entscheid: 'abgelehnt' as const,
      grund: null
    }))

    expect(lernDigest(viele).split('\n')).toHaveLength(21)
    expect(lernDigest([])).toBe('')
  })
})

function fakten(ueber: Partial<SendungsFakten> = {}): SendungsFakten {
  return {
    gemeinde: 'Aesch',
    sendung: 'regionaljournal',
    datum: '2026-08-31',
    titel: 'Schulhaus wird saniert',
    zusammenfassung: 'Kosten: 4 Millionen Franken. Baubeginn im Jahr 2027.',
    zeitmarkeSekunden: 261,
    quellUrl: 'https://srf.ch/audio/a.mp3',
    ...ueber
  }
}

describe('Meldung', () => {
  it('gibt dem Modell die Wendung vor, die die Pruefung sucht', () => {
    expect(buildSendungPrompt(fakten())).toContain(
      'wie das Regionaljournal Basel Baselland von SRF berichtete'
    )
    expect(buildSendungPrompt(fakten({ sendung: 'punkt6' }))).toContain(
      'wie Telebasel in der Sendung punkt6 berichtete'
    )
  })

  // Der Zeitpunkt gehoert in die Adresse: so wird aus "die Sendung sagte das"
  // ein "hoeren Sie es selbst ab 4:21".
  it('baut die Quellenzeile mit Zeitmarke, je Sendung anders', () => {
    expect(quelleZeile(fakten())).toBe(
      'Quelle: Regionaljournal Basel Baselland (SRF) vom 31. August 2026, https://srf.ch/audio/a.mp3#t=261'
    )
    expect(
      quelleZeile(
        fakten({
          sendung: 'punkt6',
          quellUrl: 'https://telebasel.ch/e/1',
          zeitmarkeSekunden: 49
        })
      )
    ).toContain('https://telebasel.ch/e/1?t=49')
  })

  it('laesst die Zeitmarke weg, wo es keine gibt', () => {
    expect(quelleZeile(fakten({ zeitmarkeSekunden: null }))).toBe(
      'Quelle: Regionaljournal Basel Baselland (SRF) vom 31. August 2026, https://srf.ch/audio/a.mp3'
    )
    expect(quelleZeile(fakten({ quellUrl: null }))).toBe(
      'Quelle: Regionaljournal Basel Baselland (SRF) vom 31. August 2026'
    )
  })

  it('haengt die Quelle als eigenen Absatz an', () => {
    expect(mitQuelle('Text.', fakten()).split('\n\n')).toHaveLength(2)
  })
})

describe('Pruefungen', () => {
  it('meldet eine fehlende Attribution', () => {
    expect(attributionsWarnung('In Aesch wird saniert.', fakten())).toContain(
      'Regionaljournal Basel Baselland'
    )
    expect(
      attributionsWarnung(
        'Wie das Regionaljournal Basel Baselland berichtete …',
        fakten()
      )
    ).toBeNull()
  })

  it('meldet jede Zahl, die nicht in den Angaben steht', () => {
    expect(
      zahlWarnungen('4 Millionen Franken, Baubeginn 2027.', fakten())
    ).toEqual([])
    expect(
      zahlWarnungen('Die 12 Klassenzimmer kosten 4 Millionen.', fakten())
    ).toEqual(['Zahl "12" steht nicht in den Angaben.'])
  })
})

describe('darfWeg', () => {
  const zeile = (ueber = {}) => ({
    id: 'a',
    entscheid: 'offen',
    date_created: '2026-08-20',
    ...ueber
  })

  // Eine Sendung ist verderblich: niemand schreibt eine Meldung ueber den
  // Radiobeitrag der letzten Woche.
  it('raeumt Unentschiedenes nach sieben Tagen weg', () => {
    expect(darfWeg(zeile({ date_created: '2026-08-24' }), '2026-08-31')).toBe(
      true
    )
    expect(darfWeg(zeile({ date_created: '2026-08-25' }), '2026-08-31')).toBe(
      false
    )
  })

  it('fasst nie an, worueber schon entschieden ist', () => {
    for (const entscheid of ['uebernommen', 'abgelehnt', 'weitergereicht']) {
      expect(
        darfWeg(zeile({ entscheid, date_created: '2020-01-01' }), '2026-08-31')
      ).toBe(false)
    }
  })

  it('kommt mit einem vollen Zeitstempel zurecht', () => {
    expect(
      darfWeg(zeile({ date_created: '2026-08-01T09:12:00.000Z' }), '2026-08-31')
    ).toBe(true)
  })
})

describe('buildSendungRevision', () => {
  // Gleiche Regel wie bei der Presseschau: die Revision darf das ganze
  // Transkript einsehen, der Ueberlappungs-Check haelt sie bei eigenen Worten.
  it('gibt der Revision das Transkript mit, wenn eines da ist', () => {
    const revision = buildSendungRevision(
      fakten(),
      { titel: 'Alt', lead: 'Alt.', text: 'Alter Text.' },
      'Was sagte die Gemeindepraesidentin genau?',
      'Die Gemeindepraesidentin sagte, der Kredit komme vors Volk.'
    )
    expect(revision).toContain('Transkript der Sendung')
    expect(revision).toContain('vors Volk')

    const ohne = buildSendungRevision(
      fakten(),
      { titel: 'Alt', lead: 'Alt.', text: 'Alter Text.' },
      'Kuerzer bitte.'
    )
    expect(ohne).not.toContain('Transkript der Sendung')
  })
})

describe('lernDigest mit Kommentar, verworfener Meldung und Urteil der Chefredaktion', () => {
  it('liest den Kommentar der Redaktion zurueck — er wurde gespeichert und nie gelesen', () => {
    const digest = lernDigest([
      {
        titel: 'Aeschenplatz',
        gemeinde: 'Aesch',
        entscheid: 'abgelehnt',
        grund: 'nicht_relevant',
        kommentar: 'Basler Strassenname, nicht die Gemeinde'
      }
    ])
    expect(digest).toContain(
      '→ nein (nicht relevant: Basler Strassenname, nicht die Gemeinde)'
    )
  })

  it('markiert eine danach verworfene Meldung und liest die Faehrte nach dem Urteil', () => {
    const digest = lernDigest([
      {
        titel: 'Tempo 30',
        gemeinde: 'Muenchenstein',
        entscheid: 'uebernommen',
        grund: null,
        meldungVerworfen: { grund: 'stand schon im Amtsblatt' }
      },
      {
        titel: 'Tramumbau',
        gemeinde: 'Muttenz',
        entscheid: 'weitergereicht',
        grund: null,
        faehrte: { status: 'kein_hinweis', kommentar: null, automatisch: false }
      },
      {
        titel: 'Automatisch',
        gemeinde: 'Muttenz',
        entscheid: 'weitergereicht',
        grund: null,
        faehrte: { status: 'offen', kommentar: null, automatisch: true }
      }
    ])
    expect(digest).toContain(
      'ja, daraus wurde eine Meldung — die Meldung dazu wurde danach verworfen: stand schon im Amtsblatt'
    )
    expect(digest).toContain(
      '"Tramumbau" → nein — die Chefredaktion legte die Faehrte ab'
    )
    // Von einer Regel weitergereicht und noch nicht beurteilt: kein Beispiel,
    // sonst fuettert die Automatik sich selbst.
    expect(digest).not.toContain('Automatisch')
  })

  it('stellt Bilanz und liegen Gelassenes vor die Beispiele und deklariert die Kappung', () => {
    const digest = lernDigest(
      [
        { titel: 'X', gemeinde: 'Aesch', entscheid: 'uebernommen', grund: null }
      ],
      20,
      {
        bilanz:
          'Bilanz der letzten 30 Tage dieser Sendung: 12 Vorschlaege — 2 uebernommen, 0 weitergereicht, 3 abgelehnt, 7 liegen gelassen.',
        verfallene: ['Liegengeblieben'],
        kappung: '(5 weitere Entscheide nicht aufgefuehrt)'
      }
    )
    const zeilen = digest.split('\n')
    expect(zeilen[1]).toContain('Bilanz der letzten 30 Tage')
    expect(digest.indexOf('Liegengeblieben')).toBeLessThan(
      digest.indexOf('"X"')
    )
    expect(zeilen[zeilen.length - 1]).toBe(
      '(5 weitere Entscheide nicht aufgefuehrt)'
    )
  })
})

describe('Regeln der Redaktion im Prompt', () => {
  it('stellt die Sichtungsregeln vor die Beispiele, vor dem Wortlaut', () => {
    const prompt = buildInventarPrompt(
      {
        titel: 'Tempo 30',
        text: 'In Muenchenstein gilt bald Tempo 30.',
        sendung: 'regionaljournal',
        datum: '2026-09-01'
      },
      ['Muenchenstein'],
      'So hat die Redaktion bei dieser Sendung zuletzt entschieden: …',
      'Regeln der Redaktion:\nR1: Verkehrsanordnungen sind Kandidaten.'
    )
    expect(prompt.indexOf('R1: Verkehrsanordnungen')).toBeLessThan(
      prompt.indexOf('So hat die Redaktion')
    )
    expect(prompt.indexOf('So hat die Redaktion')).toBeLessThan(
      prompt.indexOf('Wortlaut des Beitrags')
    )
    expect(INVENTAR_SYSTEM_PROMPT).not.toContain(
      'Verkehrsanordnungen sind Kandidaten'
    )
  })

  it('gibt einer Meldung die Textregeln als Redaktionelle Vorgaben mit', () => {
    const prompt = buildSendungPrompt(fakten(), [
      'Nenne die Sendung im ersten Satz.'
    ])
    expect(prompt).toContain('- Nenne die Sendung im ersten Satz.')
  })
})

describe('parseInventar — Empfehlung zum Weiterreichen', () => {
  it('traegt Empfehlung und Regelnummer durch', () => {
    const [kandidat] = parseInventar(
      {
        kandidaten: [
          {
            gemeinde: 'Muttenz',
            titel: 'Tramumbau',
            zusammenfassung: 'x',
            begruendung: 'y',
            empfehlung: 'weiterreichen',
            empfehlung_regel: 'R1'
          }
        ]
      },
      ['Muttenz']
    )
    expect(kandidat?.empfehlung).toBe('weiterreichen')
    expect(kandidat?.empfehlung_regel).toBe('R1')
  })
})
