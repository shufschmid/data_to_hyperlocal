import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bundFuer, bundUrl, liesBund, parseBund, tendenz } from './bund'

const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/bund-2026-09-27-ohne-kantone.json', import.meta.url),
    'utf8'
  )
) as unknown

describe('parseBund — das Ergebnis des Bundes', () => {
  it('liest die Vorlagen des Tages mit dem Zwischenstand, am Nachmittag noch nicht beendet', () => {
    const liste = parseBund(fixture)
    expect(liste).toHaveLength(2)
    expect(liste[0]?.titel).toMatch(/Neutralitätsinitiative/)
    expect(liste.every((v) => !v.beendet)).toBe(true)
    // 30,9 Prozent Ja, 0 zu 18,5 Staende bisher: die Tendenz ist Nein.
    expect(liste[0]).toMatchObject({
      angenommen: false,
      staendeJa: 0,
      staendeNein: 18.5,
      stand: '2026-09-27T14:34:01'
    })
    expect(liste[0]?.jaProzent).toBeCloseTo(30.93, 2)
  })

  it('traut `vorlageAngenommen` erst, wenn die Vorlage beendet ist', () => {
    const liste = parseBund({
      schweiz: {
        vorlagen: [
          {
            vorlagenTitel: [{ langKey: 'de', text: 'A' }],
            vorlageBeendet: false,
            vorlageAngenommen: true
          },
          {
            vorlagenTitel: [{ langKey: 'de', text: 'B' }],
            vorlageBeendet: true,
            vorlageAngenommen: false
          }
        ]
      }
    })
    expect(liste.map((v) => [v.titel, v.beendet, v.angenommen])).toEqual([
      ['A', false, null],
      ['B', true, false]
    ])
  })

  it('nimmt als Tendenz Volks- und Staendemehr, bei Gleichstand keine', () => {
    expect(tendenz(55, null, null)).toBe(true)
    expect(tendenz(45, null, null)).toBe(false)
    expect(tendenz(55, 8, 12)).toBe(false)
    expect(tendenz(55, 12, 8)).toBe(true)
    expect(tendenz(50, 12, 8)).toBeNull()
    expect(tendenz(55, 10, 10)).toBeNull()
    expect(tendenz(null, null, null)).toBeNull()
  })

  it('paart ueber den Titel, nie ueber die Reihenfolge', () => {
    const liste = parseBund(fixture)
    expect(
      bundFuer(
        'Volksinitiative «Wahrung der schweizerischen Neutralität (Neutralitätsinitiative)»',
        liste
      )
    ).toBe(liste[0])
    expect(bundFuer('Eine kantonale Vorlage', liste)).toBeNull()
  })
})

describe('liesBund', () => {
  it('baut die Adresse aus dem Tag', () => {
    expect(
      bundUrl('https://ogd-static.voteinfo-app.ch/v1/ogd', '2026-09-27')
    ).toBe(
      'https://ogd-static.voteinfo-app.ch/v1/ogd/sd-t-17-02-20260927-eidgAbstimmung.json'
    )
  })

  it('kennt ohne Datei keinen Bund', async () => {
    const leer = async () => new Response('', { status: 404 })
    expect(await liesBund('https://x', '2026-09-27', leer)).toBeNull()
  })

  it('wirft bei einer anderen Absage', async () => {
    const kaputt = async () => new Response('', { status: 500 })
    await expect(liesBund('https://x', '2026-09-27', kaputt)).rejects.toThrow(
      /500/
    )
  })
})
