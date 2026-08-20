import { describe, expect, it } from 'vitest'
import {
  absolutesDatum,
  buildSpielberichtPrompt,
  buildSpielberichtRevision,
  parseSpielbericht,
  zahlWarnungen,
  zeitWarnungen,
  type SpielFakten
} from './spielbericht'

// Das erste echte Resultat: FC Reinach 3:3 FC Amicitia Riehen, 19.08.2026.
const FAKTEN: SpielFakten = {
  heim: 'FC Reinach',
  gast: 'FC Amicitia Riehen',
  toreHeim: 3,
  toreGast: 3,
  wettbewerb: 'Meisterschaft - 2. Liga (FAEW)',
  datum: '2026-08-19T18:00:00.000Z',
  ort: 'Fiechten - 1, Reinach',
  verein: 'FC Amicitia Riehen',
  gemeinde: 'Riehen',
  liga: null,
  notiz: 'Der groesste Fussballverein der Gemeinde.',
  frueher: []
}

describe('absolutesDatum', () => {
  // Der Text muss in fuenf Jahren noch stimmen — darum nie "am Samstag".
  it('schreibt das Datum aus, in Schweizer Zeit', () => {
    expect(absolutesDatum('2026-08-19T18:00:00.000Z')).toBe('19. August 2026')
  })

  it('vertraegt einen kaputten Wert', () => {
    expect(absolutesDatum('kein datum')).toBe('kein datum')
  })
})

describe('buildSpielberichtPrompt', () => {
  const prompt = buildSpielberichtPrompt(FAKTEN)

  it('nennt das Resultat in Spielrichtung', () => {
    expect(prompt).toContain('Resultat: 3:3 (Heim:Gast)')
    expect(prompt).toContain('Heim: FC Reinach')
    expect(prompt).toContain('Gast: FC Amicitia Riehen')
  })

  // Wer gewonnen hat, haengt daran, auf welcher Seite unser Verein stand.
  // Das ist Rechnen — und Rechnen ist genau das, was das Modell nicht tun soll.
  it('sagt den Ausgang, statt ihn herleiten zu lassen', () => {
    expect(prompt).toContain('Die Partie endete unentschieden.')
  })

  it('erkennt einen Auswaertssieg', () => {
    const p = buildSpielberichtPrompt({ ...FAKTEN, toreHeim: 1, toreGast: 4 })
    expect(p).toContain('FC Amicitia Riehen hat gewonnen.')
  })

  it('erkennt eine Heimniederlage des eigenen Vereins', () => {
    const p = buildSpielberichtPrompt({
      ...FAKTEN,
      heim: 'FC Amicitia Riehen',
      gast: 'FC Reinach',
      toreHeim: 0,
      toreGast: 2
    })
    expect(p).toContain('FC Amicitia Riehen hat verloren.')
  })

  it('gibt das Datum absolut mit', () => {
    expect(prompt).toContain('19. August 2026')
  })

  it('nimmt frueher Gespieltes als Gedaechtnis mit', () => {
    const p = buildSpielberichtPrompt({
      ...FAKTEN,
      frueher: [
        {
          datum: '2026-08-12T18:00:00.000Z',
          heim: 'FC Amicitia Riehen',
          gast: 'FC Aesch',
          toreHeim: 2,
          toreGast: 1
        }
      ]
    })
    expect(p).toContain('Frueher in dieser Saison:')
    expect(p).toContain('FC Amicitia Riehen 2:1 FC Aesch')
  })

  it('laesst weg, was nicht bekannt ist', () => {
    const p = buildSpielberichtPrompt({ ...FAKTEN, ort: null, notiz: null })
    expect(p).not.toContain('Ort:')
    expect(p).not.toContain('Bedeutung')
  })
})

describe('parseSpielbericht', () => {
  it('nimmt eine vollstaendige Antwort', () => {
    expect(
      parseSpielbericht({ titel: 'T', lead: 'L', text: 'Ein Absatz.' })
    ).toEqual({ titel: 'T', lead: 'L', text: 'Ein Absatz.' })
  })

  it('weist eine unvollstaendige Antwort zurueck, statt sie zu flicken', () => {
    expect(() => parseSpielbericht({ titel: 'T', lead: 'L' })).toThrow(/text/)
    expect(() =>
      parseSpielbericht({ titel: '  ', lead: 'L', text: 'x' })
    ).toThrow(/titel/)
    expect(() => parseSpielbericht(null)).toThrow()
  })
})

describe('zeitWarnungen', () => {
  it('findet relative Zeitangaben', () => {
    expect(zeitWarnungen('Am Samstag gewann der FC.')).toContain(
      'Relativer Zeitbezug: "am samstag"'
    )
    expect(zeitWarnungen('Kürzlich verlor die Mannschaft.').length).toBe(1)
  })

  it('schweigt bei einem absoluten Datum', () => {
    expect(
      zeitWarnungen('Am 19. August 2026 trennten sich beide 3:3.')
    ).toEqual([])
  })
})

describe('zahlWarnungen', () => {
  it('laesst Resultat, Tag und Jahr durch', () => {
    expect(zahlWarnungen('Am 19. August 2026 endete es 3:3.', FAKTEN)).toEqual(
      []
    )
  })

  // Tabellenplatz, Punktzahl, Tordifferenz — genau die Zahlen, die still falsch werden.
  it('meldet eine Zahl, die nirgends steht', () => {
    const w = zahlWarnungen('Damit klettert der Club auf Rang 7.', FAKTEN)
    expect(w).toEqual(['Zahl "7" steht nicht in den Angaben.'])
  })

  it('laesst Ziffern aus dem Wettbewerbsnamen durch', () => {
    expect(zahlWarnungen('In der 2. Liga endete es 3:3.', FAKTEN)).toEqual([])
  })

  it('kennt auch die Zahlen frueherer Spiele', () => {
    const mit = {
      ...FAKTEN,
      frueher: [
        {
          datum: '2026-08-12T18:00:00.000Z',
          heim: 'FC Amicitia Riehen',
          gast: 'FC Aesch',
          toreHeim: 2,
          toreGast: 1
        }
      ]
    }
    expect(zahlWarnungen('Zuvor hatte es 2:1 geheissen.', mit)).toEqual([])
  })
})

describe('buildSpielberichtRevision', () => {
  const bisher = {
    titel: 'FC Amicitia Riehen holt Unentschieden bei FC Reinach',
    lead: 'Der FC Amicitia Riehen hat 3:3 gespielt.',
    text: 'Ein Absatz.'
  }
  const prompt = buildSpielberichtRevision(
    FAKTEN,
    bisher,
    'Kuerzer, maximal zwei Saetze.'
  )

  // Die Fakten stehen vollstaendig drin: neu geschrieben wird aus der Quelle,
  // nicht aus der eigenen frueheren Prosa.
  it('wiederholt die Fakten vollstaendig', () => {
    expect(prompt).toContain('Resultat: 3:3 (Heim:Gast)')
    expect(prompt).toContain('Die Partie endete unentschieden.')
    expect(prompt).toContain('19. August 2026')
  })

  it('nennt den bisherigen Bericht und die Anweisung', () => {
    expect(prompt).toContain('Bisheriger Bericht:')
    expect(prompt).toContain(bisher.titel)
    expect(prompt).toContain('Anweisung der Redaktion:')
    expect(prompt).toContain('Kuerzer, maximal zwei Saetze.')
  })

  it('verlangt weiterhin nur die Angaben von oben', () => {
    expect(prompt).toContain('weiterhin ausschliesslich die Angaben oben')
  })

  it('vertraegt einen Bericht ohne Titel', () => {
    const p = buildSpielberichtRevision(
      FAKTEN,
      { titel: null, lead: null, text: null },
      'x'
    )
    expect(p).toContain('Titel: ')
  })
})
