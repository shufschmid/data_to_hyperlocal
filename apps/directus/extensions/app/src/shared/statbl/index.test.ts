import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GEMEINDE_SPALTE,
  JAHR_SPALTE,
  ladeReihe,
  ladeTabelle,
  StatblFehler,
  tabellenId,
  tabellenUrl,
  type Holer
} from './index'

const seite = (jahr: string): string =>
  readFileSync(join(__dirname, 'fixtures', `7_1_1_3-${jahr}.html`), 'utf8')

/** Serves the two fixtures and records what was asked for. No network. */
function holer(): Holer & { aufrufe: string[] } {
  const aufrufe: string[] = []
  const fn = (async (url: string) => {
    aufrufe.push(url)
    const jahr = /year=(\d{4})/.exec(url)?.[1] ?? '2025'
    const vorhanden = jahr === '2013' || jahr === '2025'

    return {
      ok: vorhanden,
      status: vorhanden ? 200 : 404,
      text: async () => (vorhanden ? seite(jahr) : 'Page not found')
    }
  }) as Holer & { aufrufe: string[] }

  fn.aufrufe = aufrufe
  return fn
}

describe('tabellenId', () => {
  it('nimmt die URL, die im Portal in der Adresszeile steht', () => {
    expect(tabellenId('https://statistik.bl.ch/web_portal/7_1_1_3')).toBe(
      '7_1_1_3'
    )
    expect(
      tabellenId('https://statistik.bl.ch/web_portal/7_1_1_3?year=2013')
    ).toBe('7_1_1_3')
    expect(tabellenId(' https://statistik.bl.ch/web_portal/2_9_2/ ')).toBe(
      '2_9_2'
    )
  })

  // Gespeichert wird nur die ID, nie die URL: sonst waere jede gespeicherte
  // Zeile ein Ziel, das irgendwohin zeigen kann.
  it('weist alles ab, was nicht diese Tabellen sind', () => {
    expect(tabellenId('https://example.com/web_portal/7_1_1_3')).toBeNull()
    expect(tabellenId('http://statistik.bl.ch/web_portal/7_1_1_3')).toBeNull()
    expect(tabellenId('https://statistik.bl.ch/etwas/anderes')).toBeNull()
    expect(tabellenId('kein link')).toBeNull()
  })
})

describe('tabellenUrl', () => {
  it('baut die Adresse aus der ID', () => {
    expect(tabellenUrl('7_1_1_3')).toBe(
      'https://statistik.bl.ch/web_portal/7_1_1_3'
    )
    expect(tabellenUrl('7_1_1_3', '2013')).toBe(
      'https://statistik.bl.ch/web_portal/7_1_1_3?year=2013'
    )
  })
})

describe('ladeTabelle', () => {
  it('liest die aktuelle Ausgabe', async () => {
    const tabelle = await ladeTabelle('7_1_1_3', null, holer())

    expect(tabelle.jahr).toBe('2025')
    expect(tabelle.zeilen).toHaveLength(86)
  })

  it('meldet eine Seite, die keine Tabelle ist', async () => {
    const leer: Holer = async () => ({
      ok: true,
      status: 200,
      text: async () => '<html></html>'
    })
    await expect(ladeTabelle('7_1_1_3', null, leer)).rejects.toBeInstanceOf(
      StatblFehler
    )
  })

  it('meldet einen Fehlschlag mit Status', async () => {
    const weg: Holer = async () => ({
      ok: false,
      status: 503,
      text: async () => ''
    })
    await expect(ladeTabelle('7_1_1_3', null, weg)).rejects.toMatchObject({
      status: 503
    })
  })
})

describe('ladeReihe', () => {
  it('holt die aktuelle Ausgabe und die frueheren', async () => {
    const h = holer()
    const { aktuell, zeilen } = await ladeReihe('7_1_1_3', 14, h)

    expect(aktuell.jahr).toBe('2025')
    // 2025 und 2013 liegen als Fixture vor, die elf dazwischen antwortet der
    // Stub mit 404 — die fehlen, ohne dass der Rest verloren geht.
    expect(zeilen.filter((z) => z['jahr'] === '2013')).toHaveLength(86)
    expect(zeilen.filter((z) => z['jahr'] === '2025')).toHaveLength(86)
  })

  it('nennt jedes Jahr, das nicht gelesen werden konnte', async () => {
    const { uebersprungen } = await ladeReihe('7_1_1_3', 14, holer())

    expect(uebersprungen.length).toBe(11)
    expect(uebersprungen.some((u) => u.startsWith('2024'))).toBe(true)
  })

  // Die aeltere Ausgabe beschriftet die Spalten anders; angeglichen wird nach
  // Position, damit die Reihe eine Reihe bleibt.
  it('bringt die frueheren Jahre auf die heutigen Spaltennamen', async () => {
    const { zeilen } = await ladeReihe('7_1_1_3', 14, holer())
    const aesch = zeilen.filter((z) => z['gemeinde'] === 'Aesch')

    expect(aesch.map((z) => z['betriebe_total']).sort()).toEqual([11, 13])
  })

  it('haelt sich an die Obergrenze', async () => {
    const h = holer()
    await ladeReihe('7_1_1_3', 3, h)

    expect(h.aufrufe).toHaveLength(3)
  })
})

describe('die zugesicherten Spaltennamen', () => {
  // Die Pipeline muss sie kennen, ohne zu raten: detectPeriodField akzeptiert
  // nur Datumsspalten, und der Jahrgang einer Tabelle ist Text. Ohne diese
  // Zusicherung war die Zeitachse null und der Verlauf wurde nie gespeichert —
  // die Meldung sagte dann korrekt, aber nutzlos, es gebe keine Vergleichswerte.
  it('stehen in jeder gelesenen Zeile', async () => {
    const tabelle = await ladeTabelle('7_1_1_3', null, holer())
    const erste = tabelle.zeilen[0]!

    expect(Object.keys(erste)).toContain(JAHR_SPALTE)
    expect(Object.keys(erste)).toContain(GEMEINDE_SPALTE)
  })
})
