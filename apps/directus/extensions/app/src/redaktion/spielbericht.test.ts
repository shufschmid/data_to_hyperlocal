import { describe, expect, it } from 'vitest'
import {
  absolutesDatum,
  buildSpielberichtPrompt,
  buildSpielberichtRevision,
  linkWarnungen,
  mitQuelle,
  nurDasResultat,
  ohneQuelle,
  quelleZeile,
  gelernteZahlen,
  parseMeldungstext,
  parseSpielbericht,
  verbandsQuelle,
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
  quelle: {
    name: 'Fussballverband Nordwestschweiz',
    url: 'https://www.fvnws.ch/verein/default.aspx?v=12345'
  },
  telegramm: null,
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
    expect(p).toContain(
      'Frueher in dieser Saison (nur die letzten 5 Resultate):'
    )
    expect(p).toContain('FC Amicitia Riehen 2:1 FC Aesch')
  })

  it('laesst weg, was nicht bekannt ist', () => {
    const p = buildSpielberichtPrompt({ ...FAKTEN, ort: null, notiz: null })
    expect(p).not.toContain('Ort:')
    expect(p).not.toContain('Bedeutung')
  })
})

describe('Kuerze, wenn nur das Resultat bekannt ist', () => {
  // Ohne Liga, ohne Vereinsnotiz, ohne frueheres Spiel hat der Bericht nichts,
  // woraus er drei Absaetze machen koennte — ausser Erfundenem.
  const KARG: SpielFakten = {
    ...FAKTEN,
    liga: null,
    notiz: null,
    ort: null,
    frueher: []
  }

  it('erkennt den kargen Fall', () => {
    expect(nurDasResultat(KARG)).toBe(true)
  })

  it('erkennt ihn nicht, sobald es etwas zu erzaehlen gibt', () => {
    expect(nurDasResultat(FAKTEN)).toBe(false)
    expect(nurDasResultat({ ...KARG, liga: '2. Liga' })).toBe(false)
    expect(
      nurDasResultat({
        ...KARG,
        frueher: [
          {
            datum: '2026-08-12T18:00:00.000Z',
            heim: 'A',
            gast: 'B',
            toreHeim: 1,
            toreGast: 0
          }
        ]
      })
    ).toBe(false)
  })

  it('verlangt im kargen Fall zwei bis drei Saetze', () => {
    const prompt = buildSpielberichtPrompt(KARG)
    expect(prompt).toContain('SEHR kurz')
    expect(prompt).toContain('zwei bis drei Saetze')
  })

  it('sagt sonst nichts von Kuerze — der Normalfall bleibt unveraendert', () => {
    expect(buildSpielberichtPrompt(FAKTEN)).not.toContain('SEHR kurz')
  })
})

describe('parseSpielbericht', () => {
  it('nimmt eine vollstaendige Antwort — Titel und ein Absatz, kein Lead', () => {
    expect(parseSpielbericht({ titel: 'T', text: 'Ein Absatz.' })).toEqual({
      titel: 'T',
      text: 'Ein Absatz.'
    })
  })

  // Die alte Form hatte einen Lead; faellt das Modell zurueck, kostet das ein
  // Feld und nicht den ganzen Bericht.
  it('ignoriert einen mitgelieferten Lead', () => {
    expect(
      parseSpielbericht({ titel: 'T', lead: 'L', text: 'Ein Absatz.' })
    ).toEqual({ titel: 'T', text: 'Ein Absatz.' })
  })

  it('weist eine unvollstaendige Antwort zurueck, statt sie zu flicken', () => {
    expect(() => parseSpielbericht({ titel: 'T' })).toThrow(/text/)
    expect(() => parseSpielbericht({ titel: '  ', text: 'x' })).toThrow(/titel/)
    expect(() => parseSpielbericht(null)).toThrow()
  })
})

describe('parseMeldungstext', () => {
  // Presseschau, Amtsblatt und Sendung antworten weiterhin dreiteilig und
  // re-exportieren diesen Parser unter eigenem Namen.
  it('verlangt alle drei Teile', () => {
    expect(
      parseMeldungstext({ titel: 'T', lead: 'L', text: 'Ein Absatz.' })
    ).toEqual({ titel: 'T', lead: 'L', text: 'Ein Absatz.' })
    expect(() => parseMeldungstext({ titel: 'T', text: 'x' })).toThrow(/lead/)
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

  it('meldet keine Woerter, die ein Zeitwort nur enthalten', () => {
    // "morgendlichen" traegt "morgen" in sich und ist voellig haltbar — der
    // Presseschau-Durchgang hat genau das faelschlich beanstandet.
    expect(zeitWarnungen('Beim morgendlichen Ablesen der Geraete.')).toEqual([])
    expect(zeitWarnungen('Der Verein feierte gestern.').length).toBe(1)
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

describe('zahlWarnungen — Ziffern aus den Angaben selbst', () => {
  // Die Jahreszahl im Vereinsnamen und die Platznummer im Spielort SIND
  // Angaben. Sie zu melden lehrte die Redaktion nur, die Warnung zu ueberlesen.
  it('erlaubt Zahlen, die in den uebergebenen Texten stehen', () => {
    const fakten: SpielFakten = {
      ...FAKTEN,
      heim: 'FC Concordia 1907',
      ort: 'Platz 3, Reinach',
      notiz: 'Seit 1921 der Verein des Dorfs.'
    }
    const text = 'Der FC Concordia 1907 spielte auf Platz 3 — wie seit 1921.'
    expect(zahlWarnungen(text, fakten)).toEqual([])
  })

  it('erlaubt, was die Redaktion frueher akzeptiert hat', () => {
    expect(zahlWarnungen('Um 20 Uhr war Schluss.', FAKTEN)).toEqual([
      'Zahl "20" steht nicht in den Angaben.'
    ])
    expect(zahlWarnungen('Um 20 Uhr war Schluss.', FAKTEN, ['20'])).toEqual([])
  })
})

describe('gelernteZahlen', () => {
  // Publizieren trotz Warnung IST das Urteil der Redaktion. Nur Zahl-Warnungen
  // lernen — ein relativer Zeitbezug ist jedes Mal von Neuem falsch.
  it('liest die akzeptierten Zahlen aus den Warnungen einer Meldung', () => {
    expect(
      gelernteZahlen([
        'Zahl "20" steht nicht in den Angaben.',
        'Relativer Zeitbezug: "am samstag"',
        'Zahl "20" steht nicht in den Angaben.'
      ])
    ).toEqual(['20'])
  })

  it('vertraegt null und fremde Texte', () => {
    expect(gelernteZahlen(null)).toEqual([])
    expect(gelernteZahlen(['Irgendein Fehler'])).toEqual([])
  })
})

describe('verbandsQuelle', () => {
  // Die "what's on"-Seite schaut nur nach vorn: eine Woche spaeter steht das
  // Spiel nicht mehr darauf. Die Vereinsseite behaelt es — dort wird das
  // Resultat ohnehin nachgelesen.
  it('nimmt die Vereinsseite und nicht die Spielplanseite', () => {
    expect(
      verbandsQuelle(
        { quelle: 'fvnws', ergebnis_url: 'https://www.fvnws.ch/…?v=42' },
        'https://www.fvnws.ch/…/meisterschaft-fvnws.aspx'
      )
    ).toEqual({
      name: 'Fussballverband Nordwestschweiz',
      url: 'https://www.fvnws.ch/…?v=42'
    })
  })

  it('faellt auf die Adresse zurueck, aus der das Spiel gelesen wurde', () => {
    expect(
      verbandsQuelle(
        { quelle: 'swissvolley', ergebnis_url: null },
        'https://www.volleyball.ch/…/team'
      )
    ).toEqual({ name: 'Swiss Volley', url: 'https://www.volleyball.ch/…/team' })
  })

  // Lieber keine Zeile als eine erfundene — die Regel aus `quelle.ts`.
  it('sagt nichts, wo keine Adresse bekannt ist', () => {
    expect(
      verbandsQuelle({ quelle: 'handball', ergebnis_url: null }, null)
    ).toBeNull()
  })
})

describe('quelleZeile / mitQuelle', () => {
  it('haengt die Quelle als eigenen Absatz an', () => {
    expect(mitQuelle('Ein Bericht.', FAKTEN)).toBe(
      'Ein Bericht.\n\nQuelle: Fussballverband Nordwestschweiz, https://www.fvnws.ch/verein/default.aspx?v=12345'
    )
  })

  it('laesst den Text in Ruhe, wo es keine Adresse gibt', () => {
    const ohne: SpielFakten = { ...FAKTEN, quelle: null }
    expect(quelleZeile(ohne)).toBeNull()
    expect(mitQuelle('Ein Bericht.', ohne)).toBe('Ein Bericht.')
  })
})

describe('ohneQuelle', () => {
  // Sonst kopiert das Modell die Zeile in die Ueberarbeitung, `linkWarnungen`
  // meldet sie als erfundene Adresse und `mitQuelle` haengt eine zweite an.
  it('nimmt die angehaengte Zeile vor der Ueberarbeitung wieder weg', () => {
    expect(ohneQuelle(mitQuelle('Ein Bericht.', FAKTEN))).toBe('Ein Bericht.')
  })

  it('vertraegt einen Text ohne Quellenzeile und null', () => {
    expect(ohneQuelle('Ein Bericht.')).toBe('Ein Bericht.')
    expect(ohneQuelle(null)).toBeNull()
  })
})

describe('linkWarnungen', () => {
  it('meldet eine Adresse, die das Modell selbst geschrieben hat', () => {
    expect(linkWarnungen('Mehr auf https://www.fcbasel.ch dazu.')).toEqual([
      'Der Text nennt selbst eine Adresse: https://www.fcbasel.ch'
    ])
  })

  it('schweigt zum normalen Bericht', () => {
    expect(linkWarnungen('Der FC Reinach spielte 3:3.')).toEqual([])
  })
})

describe('Telegramm im Bericht', () => {
  const telegramm =
    "Cup - Basler Cup - Spielnummer: 513497\n12' 0:1 Tor Aesch Torschütze Daniel Colanero"

  it('stellt das Telegramm als Angabe in den Prompt und erlaubt zwei Absaetze', () => {
    const prompt = buildSpielberichtPrompt({ ...FAKTEN, telegramm })
    expect(prompt).toContain('Telegramm des Verbands')
    expect(prompt).toContain('Daniel Colanero')
    expect(prompt).toContain('ZWEI kurze Absaetze')
  })

  // Ein Telegramm IST mehr als das Resultat — die Kurz-Anweisung wuerde gegen
  // genau das Material kaempfen, das sie kompensieren soll.
  it('hebt die Kurz-Regel auf, sobald ein Telegramm da ist', () => {
    expect(
      nurDasResultat({
        ...FAKTEN,
        liga: null,
        notiz: null,
        frueher: [],
        telegramm
      })
    ).toBe(false)
  })

  it('erlaubt die Ziffern des Telegramms', () => {
    expect(
      zahlWarnungen('In der 12. Minute fiel das 0:1.', { ...FAKTEN, telegramm })
    ).toEqual([])
  })

  // Der Leser landet auf dem Spiel, nicht auf einer Liste, von der es rollt.
  it('zieht die Telegramm-Seite als Quelle der Vereinsseite vor', () => {
    const quelle = verbandsQuelle(
      { quelle: 'fvnws', ergebnis_url: 'https://matchcenter.example/v=482' },
      null,
      'https://matchcenter.example/v=482&tg=4403552'
    )
    expect(quelle?.url).toContain('tg=4403552')
  })
})
